const http = require("http");
const { client, query } = require("./db");

const promptPrefix = `
Create a summarized digest of the following Tweets. The tweets are separated by "==="

I care about:

- Product launches
- AI papers
- Web technologies

Output a list of key events and news, with a list of relevant Tweet IDs. Examples:

- Company X has launched Product Y. It lets users easily create songs. Tweet IDs: 12345, 87654
- There was an earthquake in South America. Tweet IDs: 847123, 57123

`;

function getValue(values, key) {
    const match = values.find((value) => value.key === key);
    return match ? match.value.string_value : "";
}

function tweetToString(tweet, indent = "") {
    const lines = [];
    function addLine(line) {
        lines.push(indent + line);
    }

    let text = tweet.full_text;
    for (const url of tweet.entities.urls || []) {
        text = text.replace(url.url, url.expanded_url);
    }
    for (const media of tweet.entities.media || []) {
        // TODO: alt text? OCR?
        text = text.replace(media.url, `<${media.type}>`);
    }

    text = text
        .split("\n")
        .map((l) => `${indent}${l}`)
        .join("\n");

    addLine(`id: ${tweet.id}`);
    addLine(`user: @${tweet.user.screen_name}`);
    addLine(`text: ${text}`);
    if (tweet.quoted_tweet) {
        addLine(`quoted tweet:`);
        addLine(tweetToString(tweet.quoted_tweet, indent + "  "));
    }
    if (tweet.card) {
        const values = tweet.card.legacy.binding_values;
        const title = getValue(values, "title");
        const description = getValue(values, "description");
        addLine("linked content:");
        addLine("  " + title);
        addLine(
            description
                .split("\n")
                .map((l) => `${indent}  ${l}`)
                .join("\n"),
        );
    }

    // TODO: retweets?

    addLine(
        `retweets : ${tweet.retweet_count} ; likes : ${tweet.favorite_count}`,
    );
    return lines.join("\n");
}

async function main() {
    const res = await query("SELECT * FROM items ORDER BY created_at DESC");

    const intermediateResults = [];

    const tweetStrings = res.rows.map((tweet) => tweetToString(tweet.content));
    while (tweetStrings.length) {
        let prompt = promptPrefix;
        while (prompt.length < 10000 && tweetStrings.length) {
            prompt += tweetStrings.shift() + "\n===\n";
        }
        console.log("BATCH");
        console.log(prompt);
        console.log("++++++++++++++++++++++++++++++++++++++++++++");
    }

    process.exit(0);
}

main();
