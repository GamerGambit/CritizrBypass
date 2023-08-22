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

function getFromID()
{
    const id = location.pathname.split("/")[4];
    return $.ajax({
        url: "https://critizr.com/bo/api/v2/threads/" + id,
        dataType: "json",
        async: false
    });
}

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
    const age = Math.round((Date.now() - Date.parse(json.last_item.object.created_at)) / 1000); // how old this dissatisfaction is in seconds
    console.log(json.id + " | Detected dissatisfaction from " + name + " | Age: " + age + "s");

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
    if (!json.last_item.object.hasOwnProperty("remark"))
    {
        console.log(json.id + " | No remark, marking as done");
        speedyMarkDone();
        return;
    }

    // Feedback needs a "type" (issue, compliment, suggestion, question)
    // For dissatisfaction, always select "issue"
    if ($(".btn-howto").length > 0)
    {
        console.log(json.id + " | Setting feedback type to \"Issue\"");
        $(".type-chooser .btn-secondary:first-child").trigger("click"); // Click "Issue" type button
        await delay(5000);
    }

    console.log(json.id + " | Clicking Reply", $("[data-trigger-action='reply']"));
    $("[data-trigger-action='reply']").trigger("click"); // Click "Reply"

    // We cant fill out the reply immediately after clicking "Reply" so wait.
    await delay(5000);

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

    const name = json.last_item.object.user.first_name.trim();
    const age = Math.round((Date.now() - Date.parse(json.last_item.object.created_at)) / 1000); // how old this message is in seconds
    console.log(json.id + " | Detected message from " + name + " | Age: " + age + "s");

    // If we have navigated to this feedback from another sometimes it takes a bit for the page to rehydrate.
    // Until its rehydrated the reply form wont exist.
    await delay(5000);

    // Since its a message and not a dissatisfaction it probably does not need to be actioned.
    speedyMarkDone();
}

async function main()
{
    const alerts = $("div.alert-navs-region > div > nav").children();
    const messages = $("div.need-or-should-reply-navs-region > div > nav").children();

    // Dissatisfaction Alerts
    console.log("Checking Dissatisfaction Alerts");
    for (let i = 0; i < alerts.length; ++i)
    {
        alerts.eq(i).trigger("click"); // Click the element
        const result = getFromID();
        await processDissatisfactionAlert(result.responseJSON, result.statusText, result);
        await delay(5000);
    };

    // Messages (could be positive feedback or replies afaik)
    for (let i = 0; i < messages.length; ++i)
    {
        messages.eq(i).trigger("click"); // Click the element
        const result = getFromID();
        await processMessage(result.responseJSON, result.statusText, result);
        await delay(5000);
    };

    // reload the page every 20 minutes to keep the sessions active
    setTimeout(function() {
        console.log("Refreshing page");
        window.location.replace("https://critizr.com/pro/messages/active/");
    }, 1000 * 60 * 20);
}

(function() {
    'use strict';

    console.log("Loaded Page");
    // Check everything after 5 seconds.. hopefully this is enough time for critizr to load everything behind the scenes
    setTimeout(main, 5000);
})();
