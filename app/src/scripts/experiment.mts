import {
    sqlQuery,
    sqlDate,
    sqlJson,
    trace,
    run,
    sqlRun,
    traceCached,
} from "./lib.mjs";
import { Configuration, OpenAIApi } from "openai";
import { encoding_for_model } from "@dqbd/tiktoken";

const dbSchema = {
    items: (row) => ({
        tweet_id: row.tweet_id,
        created_at: sqlDate(row.created_at),
        content: sqlJson(row.content),
        enrichment: sqlJson(row.enrichment),
    }),
};

const getItems = traceCached(async () => {
    return await sqlQuery("SELECT * FROM items LIMIT 10", [], dbSchema.items);
});

const configuration = new Configuration({
    apiKey: "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",
});
const openai = new OpenAIApi(configuration);

let usageTotalTokens = 0;
const createChatCompletion = traceCached(async function createChatCompletion(
    args,
) {
    const result = await openai.createChatCompletion(args);
    if (result.status !== 200) {
        throw new Error(`OpenAI Error: ${result.status}: ${result.statusText}`);
    }
    usageTotalTokens += result.data.usage.total_tokens;
    return result.data;
});

function getChunks(args: {
    prefix: string;
    suffix: string;
    items: Array<string>;
    separator: string;
    maxChunkTokens: number;
}) {
    const { prefix, suffix, items, separator, maxChunkTokens } = args;
    const enc = encoding_for_model("gpt-3.5-turbo");

    const tokensPerMessage = 4; // gpt-3.5-turbo-0301
    const prefixTokens = enc.encode(prefix).length + tokensPerMessage;
    const suffixTokens = suffix
        ? enc.encode(suffix).length + tokensPerMessage
        : 0;
    const itemTokens = items.map((item) => enc.encode(item).length);
    const separatorTokens = enc.encode(separator).length;

    const chunks = [];
    let itemIndex = 0;
    while (itemIndex < items.length) {
        const chunk = [{ role: "system", content: systemPrompt }];
        let userContent = "";
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
        chunk.push({ role: "user", content: userContent });
        if (suffix) {
            chunk.push({ role: "system", content: suffix });
        }
        chunks.push(chunk);
    }

    return chunks;
}

const systemPrompt = `
You are a javascript repl with a classify function:

classify(id: number, text: string): {
  id: number, // id of the tweet
  refs: Array<string>, // the most relevant specific person, place, event, company, or things referenced. can be empty. up to 3. avoid generic concepts.
}

Example input:
classify(1, "I love the new @openai API! It's so easy to use.")
classify(2, "My favorite cities are New York and San Francisco.")

Example output:
{"id":1,"refs":["OpenAI API"]}
{"id":2,"refs":["San Francisco", "New York"]}

Only return the json output, no extra commentary`.trim();

const tweetToString = trace(function tweetToString(tweet) {
    let text = tweet.full_text;
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

    return text;
});

async function main() {
    const items = await getItems();

    const tweetIdByShortId = new Map();
    let itemsForPrompt = [];
    for (const tweet of items) {
        const shortId = items.length;
        tweetIdByShortId.set(shortId, tweet.tweet_id);
        itemsForPrompt.push(
            `classify(${shortId}, ${JSON.stringify(
                tweetToString(tweet).replace(/\n/g, " "),
            )});`,
        );
    }

    const chunks = getChunks({
        maxChunkTokens: 750,
        prefix: systemPrompt,
        items: itemsForPrompt,
        separator: "\n",
        suffix: "",
    });

    for (const chunk of chunks) {
        const result = await createChatCompletion({
            model: "gpt-3.5-turbo-0301",
            messages: chunk,
            stop: ["\n\n"],
        });
        const completion = result.choices[0];
        if (completion.finish_reason !== "stop") {
            console.warn(
                "completion ran out of tokens! finish_reason =",
                completion.finish_reason,
            );
        }

        // TODO: response sometimes has newlines in each JSON object...
        const lines = completion.message.content.split("\n");
        for (const line of lines) {
            let parsed;
            try {
                parsed = JSON.parse(line);
            } catch (err) {
                console.error("error parsing line:", line);
            }
            if (parsed) {
                const tweetId = tweetIdByShortId.get(parsed.id);
                if (!tweetId) {
                    console.error("No tweet ID for short ID:", parsed.id);
                } else {
                    const refs = parsed.refs;
                    console.log(
                        `UPDATE ${tweetId} ${items[parsed.id]} ${JSON.stringify(
                            refs,
                        )}`,
                    );
                    await sqlRun(
                        "UPDATE items SET enrichment = $1 WHERE tweet_id = $2",
                        [JSON.stringify({ refs }), tweetId],
                    );
                }
            }
        }
    }

    console.log(
        `Total tokens used: ${usageTotalTokens} = $${
            (usageTotalTokens / 1000) * 0.002
        }`,
    );
}

run(main);
