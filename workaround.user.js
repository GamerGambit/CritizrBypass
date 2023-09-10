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

'use strict';

const FeedbackId = {
    Issue: "pb",
    Compliment: "thx",
    Question: "faq",
    Suggestion: "id"
};

let storeids = [];
const negativeWords = [
    "unhappy", "not happy", "terrible", "cold", "paid", "asked", "extra", "missing", "forgot", "doubt", "poor", "dry", "burnt", "undercooked", "soggy", "lacking", "misleading", "wrong", "pathetic", "disappoint", "incorrect", "allergic",
    "upset", "cut", "late", "barely", "but", "ordered", "mistake", "dissatisfied"
];
const dissatisfactionReply = "Hi @NAME@, thanks for your feedback. One of the management team will review this in the next 24-48 hours. Thank you for your patience.";
const promoterReply = "Hi @NAME@, we genuinely appreciate your positive feedback and will pass this on to the rest of the team.\n\nKind regards,\n@STORE@";
const pnmReply = "Hi @NAME@, thank you for your feedback. This will be shared with the management team.";

// https://stackoverflow.com/a/43376967
const toTitleCase = (phrase) => {
    return phrase
      .toLowerCase()
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  };

async function log(str, flush)
{
    console.log(str);
}

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
            return false;
    }

    // Make sure there is at least 1 store registered to this key.
    // The server will return an empty array even for bad keys
    let response;
    try
    {
        response = await fetch("https://critizr.gambyy.xyz/AuthorizedKeys/Stores/" + apikey);
    }
    catch (e)
    {
        // TypeError gets thrown if the site is unreachable
        // Check if we were authed before and if so, allow it for up to 24 hours.
        if (e instanceof TypeError)
        {
            log("Failed to contact auth server, checking last auth", true);
            let diff = Date.now() - parseInt(localStorage.getItem("lastAuth"));
            return (!isNaN(diff) && diff <= 86400000) // 86400000 is 24 hours in milliseconds
        }

        throw e;
    }

    const json = await response.json();

    // No stores assigned to this key
    if (!response.ok || json.length == 0)
    {
        alert("Invalid API Key");
        return confirmAuth();
    }

    // We have stores, so assign them to `storeids`
    storeids = json;
    putAPIKey(apikey);
    localStorage.setItem("lastAuth", Date.now());
    return true;
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isPotentiallyNegativeMessage(json)
{
    let remark = getRemark(json);

    // No remark. This happens if they filled out the survey and didnt leave a remark
    if (!remark)
    {
        log(json.id + " | IPNM | No Remark");
        return false;
    }

    // If they have a survey participation that is NOT from something like Google Reviews
    if (json.last_item.object.hasOwnProperty("survey_participation") && !json.last_item.object.hasOwnProperty("external_review"))
    {
        log(json.id + " | IPNM | Has participation...");
        // NPS > 8 (promoter)
        if (json.last_item.object.survey_participation.answer_to_highlight.value > 8)
        {
            log(json.id + " | IPNM | NPS > 8 (No answer triggering alert)", true);
            return false;
        }
    }

    log(json.id + " | IPNM | Checking for keywords [" + remark + "]", true);
    return negativeWords.some(w => remark.toLowerCase().includes(w));
}

function getRemark(json)
{
    if (json.last_item.object.hasOwnProperty("external_review"))
        return json.last_item.object.external_review.content;

    if (json.last_item.object.hasOwnProperty("remark"))
        return json.last_item.object.remark.content;
}

async function makeThreadRequest(verb, url, body)
{
    let response = await fetch(`https://critizr.com/bo/api/v2/threads/${url}`, {
        method: verb,
        headers: { "Content-Type": "application/json" },
        body: body
    });

    if (!response.ok)
        throw new Error(`${response.status} | ${response.url}`);

    return response;
}

async function markDone(json)
{
    await makeThreadRequest("POST", json.id + "/items", '{"type":"event","object":{"type":"folder_change","extra":{"folder":"done","is_subordinate":false}}}');
}

async function putOnHold(json)
{
    await makeThreadRequest("POST", json.id + "/items", '{"type":"event","object":{"type":"folder_change","extra":{"folder":"active","is_subordinate":true}}}');
}

async function sendReply(json, text)
{
    let type = json.folder == "active" ? "answer" : "pro_message";
    await makeThreadRequest("POST", json.id + "/items", JSON.stringify({ type: type, object: { content: text } }));
}

async function addInternalNode(json, text)
{
    await makeThreadRequest("POST", json.id + "/items", JSON.stringify({"type": "note", "object": { "content": text } }));
}

async function setFeedbackType(json, type)
{
    await makeThreadRequest("PATCH", json.id + "/items/" + json.last_item.id, JSON.stringify({ type: "remark", object: { type: type } }));
}

async function processDissatisfactionAlert(json)
{
    var name = json.last_item.object.user.first_name.trim();
    const age = Math.round((Date.now() - Date.parse(json.last_item.object.created_at)) / 1000); // how old this dissatisfaction is in seconds
    log(json.id + " | Detected dissatisfaction from " + name + " | Age: " + age + "s");

    // Sometimes a name is not provided and we get an email instead.
    // Prepend a space so we can do "Hi{name}" and it will look good
    if (name.length > 0)
    {
        name = " " + name;
    }

    if (!shouldProcess(json))
    {
        log(json.id + " | Ignoring. " + json.place.external_id + " not in " + storeids.join(", "), true);
        return false;
    }

    // DEBUG check that the last item is not a response from us.
    if (json.hasOwnProperty("last_item") && json.last_item.object.user.username == Critizr.user.username)
    {
        log(json.id + " | Bailing - We already replied, something has gone wrong.", true);
        return false;
    }

    // Shortcut case where the customer has left a dissatifaction but no remark.
    // Just mark it as done and bail
    if (!json.last_item.object.hasOwnProperty("remark"))
    {
        log(json.id + " | No remark, marking as done", true);
        await markDone(json);
        return true;
    }

    // Feedback needs a "type" (issue, compliment, suggestion, question)
    // For dissatisfaction, always select "issue"
    log(json.id + " | Setting feedback type to \"Issue\"");
    await setFeedbackType(json, FeedbackId.Issue);

    log(json.id + " | Sending reply", true);
    // Fill out the reply message
    await sendReply(json, dissatisfactionReply.replace("@NAME@", name));

    return true;
}

async function processMessage(json)
{
    // Messages not marked as "need_reply" can be ignored.. probably.
    if (json.state != "need_reply")
        return false;

    const name = json.last_item.object.user.first_name.trim();
    const age = Math.round((Date.now() - Date.parse(json.last_item.object.created_at)) / 1000); // how old this message is in seconds
    log(json.id + " | Detected message from " + name + " | Age: " + age + "s");

    if (!shouldProcess(json))
    {
        log(json.id + " | Ignoring. " + json.place.external_id + " not in " + storeids.join(", "));
        return false;
    }

    // DEBUG check that the last item is not a response from us.
    if (json.hasOwnProperty("last_item") && json.last_item.object.user.username == Critizr.user.username)
    {
        log(json.id + " | Bailing - We already replied, something has gone wrong.", true);
        return false;
    }

    // Check if we should potentially put them on hold.
    if (isPotentiallyNegativeMessage(json))
    {
        let response = await makeThreadRequest("GET", json.id + "/items");
        let responseJson = await response.json();
        let last = responseJson[responseJson.length - 1];
        let lastItem = last.items[last.items.length - 1];

        // If the last item in the last feedback is not a "put on hold" event, then put them on hold.
        // Putting messages on hold does not remove them from the "need_reply" state so it still needs to be actioned.
        // If we dont do this check and it is not actioned it will continuously put the message on hold.
        if (!(lastItem.type == "event" && lastItem.object.type == "folder_change" && lastItem.object.extra.folder == "active"))
        {
            log(json.id + " | potentially negative message, putting on hold", true);
            // Putting messages on hold does not remove the `need_reply` state, so we need to send a message first.
            // This message should be generic in case the feedback is not negative, but should work if it is negative.
            await sendReply(json, pnmReply.replace("@NAME@", name)); // Send a generic message
            await putOnHold(json);
            return true;
        }
    }
    else
    {
        if (json.last_item.object.hasOwnProperty("survey_participation") && !json.last_item.object.hasOwnProperty("external_review") && json.last_item.object.survey_participation.answer_to_highlight.value > 8)
        {
            log(json.id + " | NPS > 8, marking as compliment");
            await setFeedbackType(json, FeedbackId.Compliment); // Set feeback type to "Compliment"

            log(json.id + " | Sending promoter reply");
            await sendReply(json, promoterReply.replace("@NAME@", name).replace("@STORE@", toTitleCase(json.place.name))); // Send reply
        }

        log(json.id + " | Marking as done", true);
        await markDone(json);
        return true;
    }

    return false;
}

async function main()
{
    // If Critizr is reporting some error, bail and refresh the page after 5 seconds.
    if (document.querySelector(".error-view"))
    {
        log("Critizr error. Retrying in 5 seconds", true);
        await delay(5000);
        return;
    }

    log("Checking Dissatisfaction Alerts and Messages", true);
    var response = await fetch("https://critizr.com/bo/api/v2/threads?folder=active&state=need_reply&state=alert&sort=-last_item_created_at");

    if (!response.ok)
    {
        log(`Error code ${response.status} when fetching alerts and messages. Retrying in 5 seconds`, true);
        await delay(5000);
        return;
    }

    var json = await response.json();

    let processed = false;
    for (const result of json.results)
    {
        if (result.state == "alert")
        {
            processed |= await processDissatisfactionAlert(result);
        }
        else
        {
            processed |= await processMessage(result);
        }
    }

    if (json.results.length == 0 || !processed)
    {
        log("No feedbacks to process, checking again in 5 minutes", true);
        await delay(1000 * 60 * 5);
    }
}

(async function() {
    log("Loaded Page at " + new Date(Date.now()) + ", checking auth");

    while (true)
    {
        let proceed = await confirmAuth();
        if (proceed)
        {
            log("Automating feedback for store ids: " + storeids.join(", "), true);

            try
            {
                await main();
            }
            catch (e)
            {
                log(`Exception thrown: ${e} | ${e.stack}`);
                await delay(10000); // wait 10 seconds so we dont spam, if the error happens immediately after the script is active
            }

            log("Refreshing page", true);
            //window.location.replace("https://critizr.com/pro/messages/active/");
        }
        else
        {
            log("Authentication failed, trying again in 10 minutes.", true);
            await delay(1000 * 60 * 30); // retry again in 10 minutes
        }
    }
})();
