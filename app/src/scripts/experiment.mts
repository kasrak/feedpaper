import { sqlQuery, sqlDate, sqlJson, sqlRun, cached } from "./lib.mjs";
import { Configuration, OpenAIApi } from "openai";
import { encoding_for_model } from "@dqbd/tiktoken";
import endent_ from "endent";

// @ts-ignore
const endent = endent_.default;

const dbSchema = {
    items: (row) => ({
        id: row.id,
        created_at: sqlDate(row.created_at),
        content: sqlJson(row.content),
        enrichment: sqlJson(row.enrichment),
    }),
};

const getItems = async function getItems() {
    return await sqlQuery(
        "SELECT * FROM items WHERE created_at > '2023-04-17' AND created_at < '2023-04-18' AND content->'is_promoted' = 'false'",
        [],
        dbSchema.items,
    );
};

const configuration = new Configuration({
    apiKey: process.env.OPENAI_KEY,
});
const openai = new OpenAIApi(configuration);

let usageTotalTokens = 0;
const createChatCompletion = cached(async function createChatCompletion(args) {
    const maxRetries = 5;
    let numRetries = 0;
    while (true) {
        const result = await openai.createChatCompletion(args);
        if (result.status === 200) {
            usageTotalTokens += result.data.usage!.total_tokens;
            return result.data;
        } else if (result.status === 429) {
            if (numRetries < maxRetries) {
                numRetries++;
                const delay = Math.pow(2, numRetries) * 500;
                console.log(
                    `OpenAI rate limit exceeded, retrying in ${delay}ms...`,
                );
                await new Promise((resolve) => setTimeout(resolve, delay));
                continue;
            } else {
                throw new Error(
                    `OpenAI Error: ${result.status}: ${result.statusText}`,
                );
            }
        } else {
            throw new Error(
                `OpenAI Error: ${result.status}: ${result.statusText}`,
            );
        }
    }
});

type Chunk = Array<{ role: string; content: string }>;
const getChunks = function getChunks(args: {
    prefix: string;
    suffix: string;
    items: Array<string>;
    separator: string;
    maxChunkTokens: number;
}): Array<Chunk> {
    const { prefix, suffix, items, separator, maxChunkTokens } = args;
    const enc = encoding_for_model("gpt-3.5-turbo");

    const tokensPerMessage = 4; // gpt-3.5-turbo-0301
    const prefixTokens = enc.encode(prefix).length;
    const suffixTokens = suffix ? enc.encode(suffix).length : 0;
    const itemTokens = items.map((item) => enc.encode(item).length);
    const separatorTokens = enc.encode(separator).length;

    const chunks: Array<Chunk> = [];
    let itemIndex = 0;
    while (itemIndex < items.length) {
        const chunk: Chunk = [];
        let userContent = prefix;
        let chunkTokens =
            prefixTokens + tokensPerMessage /* user message */ + suffixTokens;
        while (
            chunkTokens <
            maxChunkTokens - separatorTokens - itemTokens[itemIndex]
        ) {
            userContent += items[itemIndex] + separator;
            chunkTokens += itemTokens[itemIndex] + separatorTokens;
            itemIndex++;
            if (itemIndex === items.length) {
                break;
            }
        }
        if (suffix) {
            userContent += suffix;
        }
        chunk.push({ role: "user", content: userContent });
        chunks.push(chunk);
    }

    return chunks;
};

function removeEmojis(input: string): string {
    // TODO: this doesn't quite catch everything (e.g. 🚀)...
    return input.replace(
        /(?:[\u2700-\u27bf]|(?:\ud83c[\udde6-\uddff]){2}|[\ud800-\udbff][\udc00-\udfff]|[\u0023-\u0039]\ufe0f?\u20e3|\u3299|\u3297|\u303d|\u3030|\u24c2|\ud83c[\udd70-\udd71]|\ud83c[\udd7e-\udd7f]|\ud83c\udd8e|\ud83c[\udd91-\udd9a]|\ud83c[\udde6-\uddff]|\ud83c[\ude01-\ude02]|\ud83c\ude1a|\ud83c\ude2f|\ud83c[\ude32-\ude3a]|\ud83c[\ude50-\ude51]|\u203c|\u2049|[\u25aa-\u25ab]|\u25b6|\u25c0|[\u25fb-\u25fe]|\u00a9|\u00ae|\u2122|\u2139|\ud83c\udc04|[\u2600-\u26FF]|\u2b05|\u2b06|\u2b07|\u2b1b|\u2b1c|\u2b50|\u2b55|\u231a|\u231b|\u2328|\u23cf|[\u23e9-\u23f3]|[\u23f8-\u23fa]|\ud83c\udccf|\u2934|\u2935|[\u2190-\u21ff])/gu,
        " ",
    );
}

const tweetToString = function tweetToString(tweet) {
    let text = `@${tweet.user.screen_name}: ${tweet.full_text}`;
    if (tweet.entities) {
        for (const url of tweet.entities.urls || []) {
            text = text.replace(url.url, url.expanded_url);
        }
    }

    if (tweet.quoted_tweet) {
        text += ` QT: ${tweetToString(tweet.quoted_tweet)}`;
    }
    if (tweet.card) {
        function getValue(values, key) {
            const match = values.find((value) => value.key === key);
            return match ? match.value.string_value : "";
        }
        const values = tweet.card.legacy.binding_values;
        const title = getValue(values, "title");
        const description = getValue(values, "description");
        text += ` ${title} ${description}`;
    }

    // emojis seem to hurt entity extraction
    text = removeEmojis(text);

    return text;
};

async function main() {
    const items = await getItems();

    const results: Record<
        string,
        {
            longId: string;
            shortId: number;
            tweetString: string;
            resultString?: string;
            resultParsed?: any;
        }
    > = {};
    const tweetIdByShortId = new Map();
    let itemsForPrompt: Array<string> = [];
    for (const tweet of items) {
        const numFewShotExamples = 4;
        const shortId = itemsForPrompt.length + numFewShotExamples;
        tweetIdByShortId.set(shortId, tweet.id);

        const tweetString = tweetToString(tweet.content).replace(/\n/g, "\\n");
        results[tweet.id] = {
            longId: tweet.id,
            shortId,
            tweetString,
        };

        itemsForPrompt.push(JSON.stringify({ id: shortId, text: tweetString }));
    }

    const chunks = getChunks({
        maxChunkTokens: 750,
        prefix:
            endent`
        Extract entities from these tweets:

        [
        ` + "\n",
        items: itemsForPrompt,
        separator: ",\n",
        suffix: endent`
        ]

        Output valid JSON in this format:

        {id: number, entities: Array<string>, main_entity: string, relevance: number}

        relevance is a rating from 1 to 5 based on the tweet's relevance to my interests: machine learning, ai, software, products, startups, san francisco

        Begin JSON response:
        `,
    });

    for (const chunk of chunks) {
        console.log(chunk[0].content);
        const result = await createChatCompletion({
            model: "gpt-3.5-turbo-0301",
            temperature: 0.5,
            messages: chunk,
            stop: ["\n\n"],
        });
        const completion = result.choices[0];
        if (completion.finish_reason !== "stop") {
            console.log(
                "completion ran out of tokens! finish_reason =",
                completion.finish_reason,
            );
        }
        console.log(completion.message!.content);
        console.log("=".repeat(80));

        let parsedResults: Array<{
            id: number;
            entities: Array<string>;
            main_entity: string;
            relevance: number;
        }>;
        try {
            parsedResults = JSON.parse(completion.message!.content);
            // TODO: validate with zod
            if (!Array.isArray(parsedResults)) {
                throw new Error("not an array");
            }
        } catch (err) {
            console.error("Error: parsing JSON:", err);
            continue;
        }

        for (const parsedResult of parsedResults) {
            const tweetId = tweetIdByShortId.get(parsedResult.id);
            if (!tweetId) {
                console.error(
                    "Error: No tweet ID for short ID:",
                    parsedResult.id,
                );
                continue;
            }
            const { entities, main_entity, relevance } = parsedResult;
            await sqlRun("UPDATE items SET enrichment = $1 WHERE id = $2", [
                JSON.stringify({ entities, main_entity, relevance }),
                tweetId,
            ]);
        }
    }

    console.log(
        `Total tokens used: ${usageTotalTokens} = $${
            (usageTotalTokens / 1000) * 0.002
        }`,
    );
}

main();
