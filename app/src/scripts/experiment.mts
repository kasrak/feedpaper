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

const goal = {
    "1645923578624507904": {
        refs: ["Steve Jobs"],
    },
    "1645576853489586181": {
        refs: ["bluesky"],
    },
    "1645576854785626112": {
        refs: ["bluesky", "nostr"],
    },
    "1645575030330519553": {
        refs: ["Flair"],
    },
    "1645558599610171392": {
        refs: ["AI"],
    },
    "1645571158585253888": {
        refs: ["MSR", "GPT-4"],
    },
    "1645583531316498432": {
        refs: [],
    },
    "1645599766083174401": {
        refs: ["University of Toronto Downtown Recovery"],
    },
    "1645629760037609473": {
        refs: ["Twitter", "Bluesky"],
    },
    "1645629634216869889": {
        refs: ["Twitter Circle"],
    },
    "1645808279849947137": {
        refs: ["BabyAGI"],
    },
    "1645811071230545920": {
        refs: ["BabyAGI"],
    },
    "1645846318328463360": {
        refs: ["bluesky", "AT protocol"],
    },
    "1645811222661718021": {
        refs: ["autonomous agent"],
    },
    "1645807322994978816": {
        refs: ["crdt"],
    },
    "1645807017725153283": {
        refs: ["China", "AI", "House Select Committee"],
    },
    "1645838873300172810": {
        refs: ["bluesky"],
    },
    "1645838119395291136": {
        refs: ["GPTAgent.js", "BabyAGI"],
    },
    "1645835946464509979": {
        refs: [],
    },
    "1645926946793201664": {
        refs: ["NATO"],
    },
    "1645931780011343872": {
        refs: ["Theory of Fun", "Lenses"],
    },
    "1645932707036184576": {
        refs: ["Neuralink"],
    },
    "1645934382631223305": {
        refs: [],
    },
    "1645919732753928192": {
        refs: ["Auto-GPT"],
    },
    "1645919773728083968": {
        refs: ["Replit"],
    },
    "1645894588694142976": {
        refs: ["Otto"],
    },
    "1645900214706864129": {
        refs: ["LLM", "babyagi"],
    },
    "1645905977097744384": {
        refs: ["babyagi", "Pinecone", "Slack"],
    },
    "1645918862557483008": {
        refs: ["val town", "dynamicland"],
    },
    "1645916773726969856": {
        refs: ["prompt injection"],
    },
    "1646964864844283904": {
        refs: [
            "Midjourney",
            "Stable Diffusion XL",
            "ControlNet",
            "Dreambooth",
            "LoRa",
        ],
        mainEntity: "Midjourney",
    },
};

function getDiff(
    goalItem: { refs: Array<string> },
    resultItem: { refs: Array<string> },
) {
    const goalRefs = new Set(goalItem.refs);
    const resultRefs = new Set(resultItem.refs);
    const missingRefs = [...goalRefs].filter((ref) => !resultRefs.has(ref));
    const extraRefs = [...resultRefs].filter((ref) => !goalRefs.has(ref));
    return { missingRefs, extraRefs };
}

const dbSchema = {
    items: (row) => ({
        tweet_id: row.tweet_id,
        created_at: sqlDate(row.created_at),
        content: sqlJson(row.content),
        enrichment: sqlJson(row.enrichment),
    }),
};

const getItems = traceCached(async function getItems() {
    return await sqlQuery(
        "SELECT * FROM items WHERE created_at > '2023-04-14' AND created_at < '2023-04-15' AND content->'is_promoted' = 'false'",
        [],
        dbSchema.items,
    );
});

const configuration = new Configuration({
    apiKey: "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",
});
const openai = new OpenAIApi(configuration);

let usageTotalTokens = 0;
const createChatCompletion = traceCached(async function createChatCompletion(
    args,
) {
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

const getChunks = trace(function getChunks(args: {
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

    const chunks: Array<Array<{ role: string; content: string }>> = [];
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
});

const systemPrompt = `
You are a javascript repl with a classify function:

classify(id: number, text: string): {
  id: number, // id of the tweet
  entities: Array<string>, // entities (events, companies, products, articles, etc) mentioned in the text. can be empty.
  mainEntity: string | null, // the main subject of the text, from entities. can be null.
}

Example input:
classify(2, "Came across an old pic of ~4 year old me and this is probably the coolest I've ever been.")
classify(3, "Microsoft releases DeepSpeed chat, a framework to fine tune / run multi-node RLHF on models up to 175B parameters")
classify(4, "Read the reddit thread on Ozempic improving people's impulse control broadly. Now consider: what are the downstream implications of a society with greater impulse control?")
classify(5, "That said, it feels likely that Midjourney is on a trajectory to ‘win’ the AI image gen market QT: QT: @peteromallet: Stable Diffusion XL is the most interesting release in AI - combined with ControlNet, Dreambooth/LoRa + other innovations")

Example output:
{"id":2,"entities":[],"mainEntity":null}
{"id":3,"entities":["Microsoft", "DeepSpeed chat","RLHF"],"mainEntity":"DeepSpeed chat"}
{"id":4,"entities":["Ozempic", "reddit"],"mainEntity":"Ozempic"}
{"id":5,"entities":["Midjourney", "Stable Diffusion XL", "ControlNet", "Dreambooth", "LoRa"],"mainEntity":"Midjourney"}

Only return the json output, no extra commentary`.trim();

function removeEmojis(input: string): string {
    return input.replace(
        /(?:[\u2700-\u27bf]|(?:\ud83c[\udde6-\uddff]){2}|[\ud800-\udbff][\udc00-\udfff]|[\u0023-\u0039]\ufe0f?\u20e3|\u3299|\u3297|\u303d|\u3030|\u24c2|\ud83c[\udd70-\udd71]|\ud83c[\udd7e-\udd7f]|\ud83c\udd8e|\ud83c[\udd91-\udd9a]|\ud83c[\udde6-\uddff]|\ud83c[\ude01-\ude02]|\ud83c\ude1a|\ud83c\ude2f|\ud83c[\ude32-\ude3a]|\ud83c[\ude50-\ude51]|\u203c|\u2049|[\u25aa-\u25ab]|\u25b6|\u25c0|[\u25fb-\u25fe]|\u00a9|\u00ae|\u2122|\u2139|\ud83c\udc04|[\u2600-\u26FF]|\u2b05|\u2b06|\u2b07|\u2b1b|\u2b1c|\u2b50|\u2b55|\u231a|\u231b|\u2328|\u23cf|[\u23e9-\u23f3]|[\u23f8-\u23fa]|\ud83c\udccf|\u2934|\u2935|[\u2190-\u21ff])/gu,
        " ",
    );
}

const tweetToString = trace(function tweetToString(tweet) {
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
});

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
        // if (!goal[tweet.tweet_id]) {
        //     continue;
        // }

        const shortId = itemsForPrompt.length;
        tweetIdByShortId.set(shortId, tweet.tweet_id);

        const tweetString = tweetToString(tweet.content).replace(/\n/g, " ");
        results[tweet.tweet_id] = {
            longId: tweet.tweet_id,
            shortId,
            tweetString,
        };

        itemsForPrompt.push(
            `classify(${shortId}, ${JSON.stringify(tweetString)});`,
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
        console.log(chunk[1].content);
        const result = await createChatCompletion({
            model: "gpt-3.5-turbo-0301",
            temperature: 0.1,
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

        // TODO: response sometimes has newlines in each JSON object...
        const lines = completion.message!.content.split("\n");
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
                    const { entities, mainEntity } = parsed;
                    const result = results[tweetId];
                    const diff = goal[tweetId]
                        ? getDiff(goal[tweetId], {
                              refs: entities,
                          })
                        : null;
                    if (diff) {
                        console.table([
                            ["id", "tweet", "main", "refs", "missing", "extra"],
                            [
                                {
                                    _html: `<a href="https://twitter.com/u/status/${tweetId}" target="_blank">${tweetId}</a>`,
                                },
                                result.tweetString,
                                mainEntity,
                                entities,
                                diff.missingRefs,
                                diff.extraRefs,
                            ],
                        ]);
                    }
                    await sqlRun(
                        "UPDATE items SET enrichment = $1 WHERE tweet_id = $2",
                        [JSON.stringify({ mainEntity, entities }), tweetId],
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
