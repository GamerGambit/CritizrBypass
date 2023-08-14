// ==UserScript==
// @name         Critizr/Goodays AI Workaround
// @namespace    http://tampermonkey.net/
// @version      0.1
// @description  try to take over the world!
// @author       Tyler Duffus
// @match        https://critizr.com/pro/messages/active/*
// @icon         https://critizr.com/media/backoffice/misc/favicon-32x32.png
// @grant        none
// ==/UserScript==

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function speedyMarkDone()
{
    $("[data-trigger-action='mark_as_done']").trigger("click");
}

async function processDissatisfactionAlert(json, textStatus, xhr)
{
    var name = json.last_item.object.user.first_name.trim();
    console.log(json.id + " | Detected dissatisfaction from " + name);

    // Sometimes a name is not provided and we get an email instead.
    // Prepend a space so we can do "Hi{name}" and it will look good
    if (name.length > 0)
    {
        name = " " + name;
    }

    // If we have navigated to this feedback from another sometimes it takes a bit for the page to rehydrate.
    // Until its rehydrated the reply form wont exist.
    await delay(5000);

    // Shortcut case where the customer has left a dissatifaction but no remark.
    // Just mark it as done and bail
    if ($(".participation-item-no-remark").length > 0)
    {
        speedyMarkDone();
        return;
    }

    // Feedback needs a "type" (issue, compliment, suggestion, question)
    // For dissatisfaction, always select "issue"
    // BUG: when you select a type the page is "rehydrated" so the actual reply code wont execute. Just return now and the alert should get picked up in the next run.
    if ($(".btn-howto").length > 0)
    {
        console.log(json.id + " | Setting feedback type to \"Issue\"");
        $(".type-chooser .btn-secondary:first-child").trigger("click"); // Click "Issue" type button
        return;
    }

    console.log(json.id + " | Clicking Reply", $("[data-trigger-action='reply']"));
    $("[data-trigger-action='reply']").trigger("click"); // Click "Reply"

    // We cant fill out the reply immediately after clicking "Reply" so wait.
    await delay(2000);

    console.log(json.id + " | Filling out reply field");
    // Fill out the reply message
    $("#reply-pane-view-textarea")
        .val("Hi" + name + ", thanks for your feedback. One of the management team will review this in the next 24-48 hours. Thank you for your patience.")
        .trigger("input");

    console.log(json.id + " | Toggling hold switch");
    $(".toggle-switch-thumb").trigger("click"); // Set the reply mode to put the customer on hold
    $(".send-button > button:first-child").trigger("click"); // Click "Send and put on hold" button.

    // Potentially wait for the spell checker modal
    await delay(10000);

    // Spell checker modal
    if ($(".spell-checker").length > 0)
    {
        console.log(json.id + " | Detected spell checker modal");
        // Click "Confirm and Send"
        $(".modal-footer button:last-child").trigger("click");
    }
}

async function processMessage(json, textStatus, xhr)
{
    // Messages not marked as "need_reply" can be ignored.. probably.
    if (json.state != "need_reply")
        return;

    var name = json.last_item.object.user.first_name.trim();
    console.log(json.id + " | Detected message from " + name);

    // If we have navigated to this feedback from another sometimes it takes a bit for the page to rehydrate.
    // Until its rehydrated the reply form wont exist.
    await delay(2000);

    // Since its a message and not a dissatisfaction it probably does not need to be actioned.
    speedyMarkDone();
}

function main()
{
    // Dissatisfaction Alerts
    console.log("Checking Dissatisfaction Alerts");
    $("div.alert-navs-region > div > nav").children().each(function(i, e){
        $(e).trigger("click"); // Click the element
        const id = location.pathname.split("/")[4];
        $.ajax({
            url: "https://critizr.com/bo/api/v2/threads/" + id,
            dataType: 'json',
            async: false,
            success: processDissatisfactionAlert
        });
    });

    // Messages (could be positive feedback or replies afaik)
    $("div.need-or-should-reply-navs-region > div > nav").children().each(function(i, e){
        $(e).trigger("click"); // Click the element
        const id = location.pathname.split("/")[4];
        $.ajax({
            url: "https://critizr.com/bo/api/v2/threads/" + id,
            dataType: 'json',
            async: false,
            success: processMessage
        });
    });

    // reload the page every 20 minutes to keep the sessions active
    setTimeout(function() {
        console.log("Refreshing page");
        location.reload();
    }, 1000 * 60 * 20);
}

(function() {
    'use strict';

    // Check everything after 5 seconds.. hopefully this is enough time for critizr to load everything behind the scenes
    setTimeout(main, 5000);

})();
