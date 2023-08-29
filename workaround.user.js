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

let storeids = [];
const negativeWords = [
    "unhappy", "not happy", "terrible", "cold", "paid", "asked", "extra", "missing", "forgot", "doubt", "poor", "dry", "burnt", "undercooked", "soggy", "lacking", "misleading", "wrong", "pathetic", "dissapoint", "incorrect", "allergic",
    "upset", "cut", "late", "barely", "but", "ordered"
];

function getAPIKey()
{
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.apikey || localStorage.getItem("apikey");
}

function putAPIKey(key)
{
    localStorage.setItem("apikey", key);
}

function getFromID()
{
    const id = location.pathname.split("/")[4];
    return $.ajax({
        url: "https://critizr.com/bo/api/v2/threads/" + id,
        dataType: "json",
        async: false
    });
}

function shouldProcess(json)
{
    return storeids.includes(parseInt(json.place.external_id, 10));
}

function isPotentiallyNegativeMessage(json)
{
    // No remark. This happens if they filled out the survey and didnt leave a remark
    if (!json.last_item.object.hasOwnProperty("remark"))
        return false;

    if (json.last_item.object.hasOwnProperty("survey_participation"))
    {
        // No questions marked as triggering a dissatisfaction (for NPS > 8
        if (json.last_item.object.survey_participation.answer_triggering_alert === null)
            return false;
    }

    return negativeWords.some(w => json.last_item.object.remark.content.toLowerCase().includes(w));
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

    if (!shouldProcess(json))
    {
        console.log("Ignoring. " + json.place.external_id + " not in " + storeids.join(", "));
        return;
    }

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
    await delay(5000);

    // Spell checker modal
    if ($(".spell-checker").length > 0)
    {
        console.log(json.id + " | Detected spell checker modal");
        // Click "Confirm and Send"
        $(".modal-footer button:last-child").trigger("click");

        // Wait for the modal to disappear
        await delay(5000);
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

    if (!shouldProcess(json))
    {
        console.log(json.id + " | Ignoring. " + json.place.external_id + " not in " + storeids.join(", "));
        return;
    }

    // Check if we should potentially put them on hold.
    if (isPotentiallyNegativeMessage(json))
    {
        console.log(json.id + " | Potentially negative message, putting on hold.");
        $("[data-trigger-action='mark_as_active']").click()
    }
    else
    {
        if (json.last_item.object.hasOwnProperty("survey_participation") && json.last_item.object.survey_participation.answer_to_highlight.value > 8)
        {
            console.log(json.id + " | NPS > 8, marking as compliment");
            $(".type-chooser .btn-secondary").eq(1).click(); // Click "Compliment" type button
            await delay(5000); // Wait for the page to rehydrate after choosing feedback type
        }

        speedyMarkDone();
    }

    // Wait for the page to update before returning
    await delay(5000);
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

        // Wait until the page has rehydrated.
        await delay(5000);

        const result = getFromID();
        await processDissatisfactionAlert(result.responseJSON, result.statusText, result);
    };

    // Messages (could be positive feedback or replies afaik)
    for (let i = 0; i < messages.length; ++i)
    {
        messages.eq(i).trigger("click"); // Click the element

        // Wait until the page has rehydrated.
        await delay(5000);

        const result = getFromID();
        await processMessage(result.responseJSON, result.statusText, result);
    };

    // reload the page every 20 minutes to keep the sessions active
    setTimeout(function() {
        console.log("Refreshing page");
        window.location.replace("https://critizr.com/pro/messages/active/");
    }, 1000 * 60 * 20);
}

(function() {
    'use strict';

    console.log("Loaded Page, checking auth");

    let apikey = getAPIKey();
    do
    {
        // No API key found in query parameters or localstorage so prompt for one
        if (!apikey || apikey.length == 0)
        {
            apikey = prompt("Enter your API key:");
        }

        // Cancel clicked, stop pestering.
        if (apikey === null)
            return;

        // Make sure there is at least 1 store registered to this key.
        // The server will return an empty array even for bad keys
        const response = $.ajax({url: "https://critizr.gambyy.xyz/AuthorizedKeys/Stores/" + apikey, type: "GET", dataType: "json", async: false});

        // No stores assigned to this key
        if (!response.responseJSON || response.responseJSON.length == 0)
        {
            alert("Invalid API Key");
            apikey = null;
            continue;
        }

        // We have stores, so assign them to `storeids`
        storeids = response.responseJSON;
        putAPIKey(apikey);
        break;
    }
    while(true);

    console.log("Automating feedback for store ids: " + storeids.join(", "));

    // Check everything after 5 seconds.. hopefully this is enough time for critizr to load everything behind the scenes
    setTimeout(main, 5000);
})();
