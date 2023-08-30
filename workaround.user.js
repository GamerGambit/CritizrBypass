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

const FeedbackType = {
    Issue: 0,
    Compliment: 1,
    Question: 2,
    Suggestion: 3
};

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

async function getFromID()
{
    const id = location.pathname.split("/")[4];
    const response = await fetch("https://critizr.com/bo/api/v2/threads/" + id);
    return await response.json();
}

function shouldProcess(json)
{
    return storeids.includes(parseInt(json.place.external_id, 10));
}

async function confirmAuth()
{
    let apikey = getAPIKey();
    while (apikey === null || apikey.length == 0)
    {
        apikey = prompt("Enter your API key:");

        // Cancel clicked, stop pestering.
        if (apikey === null)
            return;
    }

    // Make sure there is at least 1 store registered to this key.
    // The server will return an empty array even for bad keys
    const response = await fetch("https://critizr.gambyy.xyz/AuthorizedKeys/Stores/" + apikey);
    const json = await response.json();

    // No stores assigned to this key
    if (!response.ok || json.length == 0)
    {
        alert("Invalid API Key");
        confirmAuth();
        return;
    }

    // We have stores, so assign them to `storeids`
    storeids = json;
    putAPIKey(apikey);
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
    document.querySelector("[data-trigger-action='mark_as_done']").click();
}

async function processDissatisfactionAlert(json)
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
        console.log(json.id + " | Ignoring. " + json.place.external_id + " not in " + storeids.join(", "));
        return;
    }

    // DEBUG check that the last item is not a response from us.
    if (json.hasOwnProperty("last_item") && json.last_item.object.user.username == Critizr.user.username)
    {
        console.log(json.id + " | Bailing - We already replied, something has gone wrong.");
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
    if (document.querySelector(".btn-howto"))
    {
        console.log(json.id + " | Setting feedback type to \"Issue\"");
        document.querySelector(".type-chooser .btn-secondary:first-child").click(); // Click "Issue" type button
        await delay(5000);
    }

    console.log(json.id + " | Clicking Reply");
    document.querySelector("[data-trigger-action='reply']").click(); // Click "Reply"

    // We cant fill out the reply immediately after clicking "Reply" so wait.
    await delay(5000);

    console.log(json.id + " | Filling out reply field");
    // Fill out the reply message
    const textarea = document.querySelector("#reply-pane-view-textarea");
    textarea.value = "Hi" + name + ", thanks for your feedback. One of the management team will review this in the next 24-48 hours. Thank you for your patience.";
    textarea.dispatchEvent(new Event("input", { bubbles: true }));

    console.log(json.id + " | Toggling hold switch");
    document.querySelector(".toggle-switch-thumb").click(); // Set the reply mode to put the customer on hold
    document.querySelector(".send-button > button:first-child").click(); // Click "Send and put on hold" button.

    // Potentially wait for the spell checker modal
    await delay(5000);

    // Spell checker modal
    if (document.querySelector(".spell-checker"))
    {
        console.log(json.id + " | Detected spell checker modal");
        // Click "Confirm and Send"
        document.querySelector(".modal-footer button:last-child").click();

        // Wait for the modal to disappear
        await delay(5000);
    }
}

async function processMessage(json)
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

    // DEBUG check that the last item is not a response from us.
    if (json.hasOwnProperty("last_item") && json.last_item.object.user.username == Critizr.user.username)
    {
        console.log(json.id + " | Bailing - We already replied, something has gone wrong.");
        return;
    }

    // Check if we should potentially put them on hold.
    if (isPotentiallyNegativeMessage(json))
    {
        console.log(json.id + " | Potentially negative message, putting on hold.");
        document.querySelector("[data-trigger-action='mark_as_active']").click()
    }
    else
    {
        if (json.last_item.object.hasOwnProperty("survey_participation") && json.last_item.object.survey_participation.answer_to_highlight.value > 8)
        {
            console.log(json.id + " | NPS > 8, marking as compliment");
            document.querySelectorAll(".type-chooser .btn-secondary")[FeedbackType.Compliment].click(); // Click "Compliment" type button
            await delay(5000); // Wait for the page to rehydrate after choosing feedback type
        }

        console.log(json.id + " | Marking as done");
        speedyMarkDone();
    }

    // Wait for the page to update before returning
    await delay(5000);
}

async function main()
{
    const alerts = document.querySelector("div.alert-navs-region > div > nav").children;
    const messages = document.querySelector("div.need-or-should-reply-navs-region > div > nav").children;

    // Dissatisfaction Alerts
    console.log("Checking Dissatisfaction Alerts");
    let processed = false;
    for (const alert of alerts)
    {
        alert.click(); // Click the element

        // Wait until the page has rehydrated.
        await delay(5000);

        const result = await getFromID();
        await processDissatisfactionAlert(result);
        processed |= true;
    };

    // Messages (could be positive feedback or replies afaik)
    for (const message of messages)
    {
        message.click(); // Click the element

        // Wait until the page has rehydrated.
        await delay(5000);

        const result = await getFromID();
        await processMessage(result);
        processed |= true;
    };

    // reload the page every 5 minutes to keep the sessions active
    // and to beat the DPE bot
    if (!processed)
    {
        await delay(1000 * 60 * 5);
    }

    console.log("Refreshing page");
    window.location.replace("https://critizr.com/pro/messages/active/");
}

(async function() {
    'use strict';

    console.log("Loaded Page, checking auth");

    await confirmAuth();

    console.log("Automating feedback for store ids: " + storeids.join(", "));

    // Check everything after 5 seconds.. hopefully this is enough time for critizr to load everything behind the scenes
    await delay(5000);
    await main();
})();
