import { Configuration, OpenAIApi } from "openai";
import { dbSchema, sqlQuery, sqlRun } from "./db";
import getSettings from "./getSettings";
import { cached } from "./cached";
import { encoding_for_model } from "@dqbd/tiktoken";
import endent from "endent";

function toIsoDate(date: Date) {
    const pad = (n: number) => (n < 10 ? `0${n}` : n);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
        date.getDate(),
    )}`;
}

const timeoutMs = 5 * 60 * 1000;
const appStartTime = new Date();

async function isEnrichmentRunning() {
    // Garbage collect logs older than 1 week
    await sqlQuery("DELETE FROM enrichments WHERE started_at < $1", [
        toIsoDate(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)),
    ]);

    const unfinishedEnrichments = await sqlQuery(
        "SELECT * FROM enrichments WHERE finished_at IS NULL ORDER BY started_at DESC LIMIT 1",
        [],
        dbSchema.enrichments,
    );
    if (unfinishedEnrichments.length) {
        const createdAt = unfinishedEnrichments[0].started_at;
        const updatedAt = unfinishedEnrichments[0].updated_at;
        const isStuck = Date.now() - updatedAt.getTime() > timeoutMs;
        if (createdAt > appStartTime && !isStuck) {
            return true;
        }
    }
    return false;
}

async function markEnrichmentStarted(): Promise<number> {
    const { lastId: enrichmentId } = await sqlRun(
        "INSERT INTO enrichments (started_at, updated_at) VALUES ($1, $1)",
        [new Date().toISOString()],
    );
    return enrichmentId;
}

async function markEnrichmentProgress(
    enrichmentId: number,
    result: Partial<EnrichmentResult>,
) {
    await sqlRun(
        "UPDATE enrichments SET result = $1, updated_at = $2 WHERE id = $3",
        [
            JSON.stringify(result, null, 2),
            new Date().toISOString(),
            enrichmentId,
        ],
    );
}

type EnrichmentResult = {
    success: boolean;
    error?: string;
    totalTokens?: number;
};

async function markEnrichmentFinished(
    enrichmentId: number,
    result: EnrichmentResult,
) {
    console.log("Enrichment finished", result);
    await sqlRun(
        "UPDATE enrichments SET result = $1, finished_at = $2 WHERE id = $3",
        [
            JSON.stringify(result, null, 2),
            new Date().toISOString(),
            enrichmentId,
        ],
    );
}

type Prompt = Array<{ role: string; content: string }>;
const getPrompts = function getChunks(args: {
    prefix: string;
    suffix: string;
    items: Array<string>;
    separator: string;
    maxPromptTokens: number;
}): Array<Prompt> {
    const { prefix, suffix, items, separator, maxPromptTokens } = args;
    const enc = encoding_for_model("gpt-3.5-turbo");

    const tokensPerMessage = 4; // gpt-3.5-turbo-0301
    const prefixTokens = enc.encode(prefix).length;
    const suffixTokens = suffix ? enc.encode(suffix).length : 0;
    const itemTokens = items.map((item) => enc.encode(item).length);
    const separatorTokens = enc.encode(separator).length;

    const chunks: Array<Prompt> = [];
    let itemIndex = 0;
    while (itemIndex < items.length) {
        const chunk: Prompt = [];
        let userContent = prefix;
        let chunkTokens =
            prefixTokens + tokensPerMessage /* user message */ + suffixTokens;
        while (
            chunkTokens <
            maxPromptTokens - separatorTokens - itemTokens[itemIndex]
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
            // links seem to not be very useful for entity extraction
            text = text.replace(url.url, "");
        }
        for (const url of tweet.entities.media || []) {
            text = text.replace(url.url, "");
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
        text += ` ${title}: ${description}`;
    }

    // emojis seem to hurt entity extraction
    text = removeEmojis(text);

    // escape newlines so we're passing in "proper" JSON
    text = text.replace(/\n/g, "\\n");

    // for retweets, remove the leading "@user: RT". it's low
    // signal and sometimes trips up entity extraction by overly
    // focusing on the retweeter's name.
    text = text.replace(/^@[^:]+: RT /, "");

    return text;
};

async function getItemsToEnrich() {
    const yesterday = toIsoDate(new Date(Date.now() - 24 * 60 * 60 * 1000));
    const items = await sqlQuery(
        "SELECT * FROM items WHERE created_at > $1 AND enrichment IS NULL AND content->'is_promoted' = 'false'",
        [yesterday],
        dbSchema.items,
    );
    return items;
}

async function runEnrichment(enrichmentId: number): Promise<EnrichmentResult> {
    const settings = await getSettings();
    const openaiApiKey = ((settings.openaiApiKey as string) || "").trim();
    const interests = ((settings.interests as string) || "")
        .trim()
        .replace(/\n/g, " ");
    if (!openaiApiKey) {
        return { success: false, error: "Please provide an OpenAI API key" };
    }

    const openai = new OpenAIApi(
        new Configuration({
            apiKey: openaiApiKey,
        }),
    );
    let totalTokens = 0;
    const createChatCompletion = cached(async function createChatCompletion(
        args,
    ) {
        const maxRetries = 5;
        let numRetries = 0;
        while (true) {
            const result = await openai.createChatCompletion(args);
            if (result.status === 200) {
                totalTokens += result.data.usage!.total_tokens;
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

    const items = await getItemsToEnrich();

    const itemIdByShortId = new Map();
    const fewShotExamples = 2;
    let itemsForPrompt: Array<string> = [];
    for (const tweet of items) {
        const shortId = itemsForPrompt.length + fewShotExamples;
        itemIdByShortId.set(shortId, tweet.id);
        const tweetString = tweetToString(tweet.content);
        itemsForPrompt.push(JSON.stringify({ id: shortId, text: tweetString }));
    }

    const prompts = getPrompts({
        maxPromptTokens: 750,
        prefix:
            endent`
        Entities are people, products, organizations, titles, places.

        Only extract @handles when relevant to the topic of the tweet. Example:
        [
            {"id":0,"text":"@google: we're excited to announce our latest LLM model: Bard"},
            {"id":1,"text":"@bobsmith: san francisco housing rules impose onerous restrictions"},
        ]

        JSON reponse:
        [
            {"id":0,"entities":["@google", "LLM", "Bard"],"main_entity":"Bard"},
            {"id":1,"entities":["san francisco"],"main_entity":"san francisco"},
        ]

        Extract entities from these tweets.

        [
        ` + "\n",
        items: itemsForPrompt,
        separator: ",\n",
        suffix: interests
            ? endent`
        ]

        Output valid JSON in this format:

        {id: number, entities: Array<string>, main_entity: string, relevance: number}

        relevance is a rating from 1 (low) to 5 (high) based on the tweet's relevance to any of my interests: ${interests}

        Begin JSON response:
        `
            : endent`
        ]

        Output valid JSON in this format:

        {id: number, entities: Array<string>, main_entity: string}

        Begin JSON response:
        `,
    });

    for (const prompt of prompts) {
        console.log(prompt[0].content);
        const result = await createChatCompletion({
            model: "gpt-3.5-turbo-0301",
            temperature: 0.5,
            messages: prompt,
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
            const itemId = itemIdByShortId.get(parsedResult.id);
            if (!itemId) {
                console.error(
                    "Error: No item ID for short ID:",
                    parsedResult.id,
                );
                continue;
            }
            const { entities, main_entity, relevance } = parsedResult;
            await sqlRun("UPDATE items SET enrichment = $1 WHERE id = $2", [
                JSON.stringify({ entities, main_entity, relevance }),
                itemId,
            ]);
        }

        markEnrichmentProgress(enrichmentId, {
            totalTokens,
        });
    }

    return { success: true, totalTokens };
}

export default async function enrichItems() {
    if (await isEnrichmentRunning()) {
        console.log("Enrichment already in progress, skipping");
        return;
    }
    const enrichmentId = await markEnrichmentStarted();
    const result = await runEnrichment(enrichmentId);
    await markEnrichmentFinished(enrichmentId, result);
}
