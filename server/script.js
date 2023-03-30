const fs = require("fs");
const { client, query } = require("./db");
const { Configuration, OpenAIApi } = require("openai");
const tiktoken = require("@dqbd/tiktoken");
const trace = require("./trace");

const configuration = new Configuration({
    apiKey: "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",
});
const openai = new OpenAIApi(configuration);

function getValue(values, key) {
    const match = values.find((value) => value.key === key);
    return match ? match.value.string_value : "";
}

function isNumeric(str) {
    return !!str.match(/[0-9]+/);
}

function tweetToString(tweet, indent, shortIdByLongIdByRef) {
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

    let shortId;
    if (shortIdByLongIdByRef.has(tweet.id)) {
        shortId = shortIdByLongIdByRef.get(tweet.id);
    } else {
        shortId = shortIdByLongIdByRef.size + 1;
        shortIdByLongIdByRef.set(tweet.id, shortId);
    }

    addLine(`id:${shortId}`);
    addLine(`user:@${tweet.user.screen_name}`);
    addLine(`text:${text}`);
    if (tweet.quoted_tweet) {
        addLine(`quote tweet:`);
        addLine(
            tweetToString(
                tweet.quoted_tweet,
                indent + "  ",
                shortIdByLongIdByRef,
            ),
        );
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
    return lines.join("\n");
}

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

function getChunks(
    args /* {
    prefix: string,
    suffix: string,
    items: Array<string>,
    separator: string,
    maxChunkTokens: Number,
} */,
) {
    const { prefix, suffix, items, separator, maxChunkTokens } = args;
    const enc = tiktoken.encoding_for_model("gpt-3.5-turbo");

    const prefixTokens = enc.encode(prefix).length;
    const suffixTokens = enc.encode(suffix).length;
    const itemTokens = items.map((item) => enc.encode(item).length);
    const separatorTokens = enc.encode(separator).length;

    const chunks = [];
    let itemIndex = 0;
    while (itemIndex < items.length) {
        let chunk = prefix;
        let chunkTokens = prefixTokens;
        while (
            chunkTokens <
            maxChunkTokens -
                suffixTokens -
                separatorTokens -
                itemTokens[itemIndex]
        ) {
            chunk += items[itemIndex] + separator;
            chunkTokens += itemTokens[itemIndex] + separatorTokens;
            itemIndex++;
            if (itemIndex === items.length) {
                break;
            }
        }
        chunk += suffix;
        chunks.push(chunk);
    }

    return chunks;
}

const createChatCompletion = trace(async function createChatCompletion(args) {
    const result = await openai.createChatCompletion(args);
    return result.data;
});

async function classifyTweets(tweets) {
    // TODO: remove promoted tweets?
    // TODO: sort better, e.g. put replies and retweets next to original tweet
    const shortIdByLongId = new Map();
    const tweetStrings = tweets.map((tweet) =>
        tweetToString(tweet.content, "", shortIdByLongId),
    );
    // Reverse the map.
    const longIdByShortId = new Map(
        Array.from(shortIdByLongId.entries()).map((entry) => [
            entry[1],
            entry[0],
        ]),
    );

    const chunks = getChunks({
        maxChunkTokens: 750,
        prefix: "Here are tweets separated by ===\n\n",
        items: tweetStrings,
        separator: "\n===\n",
        suffix: `
Instruction:

Group related tweets together using this format:
Array<{"summary":string,"info_value":"high"|"medium"|"low","tweets":Array<int>}>

- summary should be short, ideally 2 to 5 words.
- info_value describes how novel or important the tweets are.
- put misc and random tweets into a group with summary "Misc"

JSON:
[{`,
    });

    const allGroups = [];
    for (const chunk of chunks) {
        const completion = (
            await createChatCompletion({
                model: "gpt-3.5-turbo-0301",
                messages: [{ role: "user", content: chunk }],
                stop: ["\n\n"],
            })
        ).choices[0];
        if (completion.finish_reason !== "stop") {
            console.warn(
                "completion ran out of tokens! finish_reason =",
                completion.finish_reason,
            );
        }
        const groups = JSON.parse("[{" + completion.message.content);
        console.log(groups);
        for (const group of groups) {
            group.tweets = group.tweets.map((tweet) =>
                longIdByShortId.get(tweet),
            );
            for (const id of group.tweets) {
                await query(
                    "UPDATE items SET enrichment = $1 WHERE tweet_id = $2",
                    [
                        JSON.stringify({
                            summary: group.summary,
                            info_value: group.info_value,
                        }),
                        id,
                    ],
                );
            }
        }
        allGroups.push(...groups);
        // TODO: pass in existing groups to subsequent chunks.
    }

    return allGroups;

    // TODO(next): parse the results, and save it in items db.
    // TODO: call every chunk.
}

async function main() {
    const res = await query(
        "SELECT * FROM items WHERE created_at > '2023-03-28' AND created_at < '2023-03-29' ORDER BY created_at, id ASC",
    );
    const data = await classifyTweets(res.rows);

    console.log("result:");
    console.log(data);

    // tweets = tweets.filter((tweet) => {
    //     return (
    //         // Remove self_replies
    //         (!tweet.self_thread || tweet.self_thread.id_str === tweet.id) &&
    //         // Remove promoted tweets
    //         !tweet._isPromoted
    //     );
    // });

    //     const prompts = [];
    //     while (tweetStrings.length) {
    //         let prompt = promptPrefix;
    //         while (prompt.length < 10000 && tweetStrings.length) {
    //             prompt += tweetStrings.shift() + "\n===\n";
    //         }
    //         prompts.push(prompt);
    //     }

    //     let completions = [];
    //     const fileId = Date.now();
    //     for (let i = 0; i < Math.min(prompts.length, 3); i++) {
    //         const prompt = prompts[i];
    //         console.log(`Prompt: ${i + 1} of ${prompts.length}...`);
    //         const completion = await openai.createChatCompletion({
    //             model: "gpt-3.5-turbo",
    //             messages: [{ role: "user", content: prompt }],
    //         });
    //         console.log(completion.data);
    //         completions.push(completion.data);

    //         fs.writeFileSync(
    //             `/tmp/feedpaper-${fileId}-${i}.json`,
    //             JSON.stringify(completions, null, 2),
    //         );
    //     }

    //     // const completions = JSON.parse(
    //     //     fs.readFileSync("/tmp/feedpaper-1679610817928-2.json"),
    //     // );

    //     const aggregatedSummaries = completions
    //         .map((c) => c.choices[0].message.content)
    //         .join("\n");
    //     const headlines = aggregatedSummaries
    //         .split("\n")
    //         .map((headline) => {
    //             // Given "- sentence [sources]", this regex extracts the sentence and sources:
    //             const match = headline.match(/- (.*) \[(.*)\]/);
    //             if (match) {
    //                 return {
    //                     sentence: match[1],
    //                     sources: match[2].split(","),
    //                 };
    //             } else {
    //                 return null;
    //             }
    //         })
    //         .filter((h) => h);

    //     const digestPrompt = `
    // The following is a list of headlines from different sources.

    // Write a digest of the headlines to merge duplicates, and cite your sources using this format [1]

    // Headlines:

    // ${headlines
    //     .map(
    //         (headline, i) =>
    //             `${i + 1}. ${headline.sentence} ${headline.sources
    //                 .map((source) => {
    //                     if (isNumeric(source)) {
    //                         source = source.trim();
    //                         return `<a href="https://twitter.com/u/status/${source}">${source}</a>`;
    //                     } else {
    //                         return "";
    //                     }
    //                 })
    //                 .join(" ")}`,
    //     )
    //     .join("\n")}
    //     `;

    //     console.log(digestPrompt);
    //     const completion = await openai.createChatCompletion({
    //         model: "gpt-4",
    //         messages: [{ role: "user", content: digestPrompt }],
    //     });
    //     const digest = completion.data.choices[0].message.content;

    //     console.log(digestPrompt);

    //     // const digest =
    //     //     "OpenAI has launched ChatGPT plugins, enabling developers to build safe AI tools for various tasks and allowing the language model to access web content, execute code, and search private data stores[1][4][10]. The ChatGPT plugin protocol is being rolled out with launch partners including Expedia, Slack, and Shopify, who have built creative extensions[15]. OpenAI's API has also been experimented with using LangChain, as demonstrated in an app that generates responses based on YouTube video content[2]. Meanwhile, GoogleAI has developed VLMaps, a map representation that fuses visual-language embeddings into a 3D reconstruction of an environment to improve robots' capabilities in indexing landmarks and path planning[3].\n\nHowever, concerns are rising over the far-reaching power of OpenAI, leading to calls for international safety regulation [12]. There is a recognition that AI breakthroughs have been transforming our world at an exponential pace, with LLMs trained in human writing and emotions potentially having dangerous real-world integrations [6][7].\n\nIn other news, CodeSandbox announces its support for PHP in its platform[11], Figma launches 30+ updates to improve user workflow[14], and they published their design team career levels to Figma Community[8]. Additionally, Sunil Pai teaches how the Partykit app can make the web more enjoyable through collaboration[9]. A Twitter user predicts that prompt-based apps will flourish in the current era[13].";

    //     console.log(digest);

    process.exit(0);
}

main();
