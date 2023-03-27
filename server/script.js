const fs = require("fs");
const http = require("http");
const { client, query } = require("./db");
const { Configuration, OpenAIApi } = require("openai");

const configuration = new Configuration({
    apiKey: "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",
});
const openai = new OpenAIApi(configuration);

const promptPrefix = `
Create a summarized digest of the following Tweets. The tweets are separated by "==="

I care about:

- Product launches
- AI papers
- Web technologies

Output a summarized list of key events and news merging related topics. Each summary should be followed by an array of relevant Tweet IDs. Examples:

- $company has launched $product. It lets users easily $use_case. [12345, 87654]
- There was an earthquake in $location. [847123, 57123, 7471234]

`;

function getValue(values, key) {
    const match = values.find((value) => value.key === key);
    return match ? match.value.string_value : "";
}

function isNumeric(str) {
    return !!str.match(/[0-9]+/);
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

    const tweetStrings = res.rows.map((tweet) => tweetToString(tweet.content));
    const prompts = [];
    while (tweetStrings.length) {
        let prompt = promptPrefix;
        while (prompt.length < 10000 && tweetStrings.length) {
            prompt += tweetStrings.shift() + "\n===\n";
        }
        prompts.push(prompt);
    }

    let completions = [];
    const fileId = Date.now();
    for (let i = 0; i < Math.min(prompts.length, 3); i++) {
        const prompt = prompts[i];
        console.log(`Prompt: ${i + 1} of ${prompts.length}...`);
        const completion = await openai.createChatCompletion({
            model: "gpt-3.5-turbo",
            messages: [{ role: "user", content: prompt }],
        });
        console.log(completion.data);
        completions.push(completion.data);

        fs.writeFileSync(
            `/tmp/feedpaper-${fileId}-${i}.json`,
            JSON.stringify(completions, null, 2),
        );
    }

    // const completions = JSON.parse(
    //     fs.readFileSync("/tmp/feedpaper-1679610817928-2.json"),
    // );

    const aggregatedSummaries = completions
        .map((c) => c.choices[0].message.content)
        .join("\n");
    const headlines = aggregatedSummaries
        .split("\n")
        .map((headline) => {
            // Given "- sentence [sources]", this regex extracts the sentence and sources:
            const match = headline.match(/- (.*) \[(.*)\]/);
            if (match) {
                return {
                    sentence: match[1],
                    sources: match[2].split(","),
                };
            } else {
                return null;
            }
        })
        .filter((h) => h);

    const digestPrompt = `
The following is a list of headlines from different sources.

Write a digest of the headlines to merge duplicates, and cite your sources using this format [1]

Headlines:

${headlines
    .map(
        (headline, i) =>
            `${i + 1}. ${headline.sentence} ${headline.sources
                .map((source) => {
                    if (isNumeric(source)) {
                        source = source.trim();
                        return `<a href="https://twitter.com/u/status/${source}">${source}</a>`;
                    } else {
                        return "";
                    }
                })
                .join(" ")}`,
    )
    .join("\n")}
    `;

    console.log(digestPrompt);
    const completion = await openai.createChatCompletion({
        model: "gpt-4",
        messages: [{ role: "user", content: digestPrompt }],
    });
    const digest = completion.data.choices[0].message.content;

    console.log(digestPrompt);

    // const digest =
    //     "OpenAI has launched ChatGPT plugins, enabling developers to build safe AI tools for various tasks and allowing the language model to access web content, execute code, and search private data stores[1][4][10]. The ChatGPT plugin protocol is being rolled out with launch partners including Expedia, Slack, and Shopify, who have built creative extensions[15]. OpenAI's API has also been experimented with using LangChain, as demonstrated in an app that generates responses based on YouTube video content[2]. Meanwhile, GoogleAI has developed VLMaps, a map representation that fuses visual-language embeddings into a 3D reconstruction of an environment to improve robots' capabilities in indexing landmarks and path planning[3].\n\nHowever, concerns are rising over the far-reaching power of OpenAI, leading to calls for international safety regulation [12]. There is a recognition that AI breakthroughs have been transforming our world at an exponential pace, with LLMs trained in human writing and emotions potentially having dangerous real-world integrations [6][7].\n\nIn other news, CodeSandbox announces its support for PHP in its platform[11], Figma launches 30+ updates to improve user workflow[14], and they published their design team career levels to Figma Community[8]. Additionally, Sunil Pai teaches how the Partykit app can make the web more enjoyable through collaboration[9]. A Twitter user predicts that prompt-based apps will flourish in the current era[13].";

    console.log(digest);

    process.exit(0);
}

main();
