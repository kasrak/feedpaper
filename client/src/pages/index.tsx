import Head from "next/head";
import { useQuery } from "react-query";
import Tweet from "@/components/Tweet";
import { useQueryParam, StringParam, withDefault } from "use-query-params";
import { useMemo } from "react";
import { BASE_URL, checkIfPlainRetweet } from "@/helpers";

function toIsoDate(date: Date) {
    return date.toISOString().split("T")[0];
}

async function getItems(date: Date) {
    const start = toIsoDate(date);
    const end = toIsoDate(new Date(date.getTime() + 24 * 60 * 60 * 1000));
    const res = await fetch(`${BASE_URL}/getItems?start=${start}&end=${end}`);
    return res.json();
}

type TweetT = any;

let clusterId = 0;
class Cluster {
    id: number;
    keys: Set<string>;
    items: Array<TweetT>;
    constructor() {
        this.id = clusterId++;
        this.keys = new Set();
        this.items = [];
    }
    addItem(item: TweetT, keys: Array<string>) {
        this.items.push(item);
        for (const key of keys) {
            this.keys.add(key);
        }
    }
    getItems(): Array<TweetT> {
        const items: Array<TweetT> = [];
        const ids = new Set<string>();
        for (const item of this.items) {
            // filter out retweets if original tweet is in items
            if (
                item.retweeted_tweet &&
                ids.has(item.retweeted_tweet.id) &&
                checkIfPlainRetweet(item)
            ) {
                continue;
            }
            items.push(item);
            ids.add(item.id);
        }
        return items;
    }
}

function setContains<T>(set: Set<T>, array: Array<T>): boolean {
    for (const item of array) {
        if (set.has(item)) {
            return true;
        }
    }
    return false;
}

function getTweetKeys(tweet: TweetT): Array<string> {
    const keys = [tweet.id];
    if (tweet.conversation_id) {
        keys.push(tweet.conversation_id);
    }
    if (tweet.self_thread && tweet.self_thread.id_str) {
        keys.push(tweet.self_thread.id_str);
    }
    if (tweet.in_reply_to_status_id) {
        keys.push(tweet.in_reply_to_status_id);
    }
    if (tweet.quoted_tweet) {
        keys.push(...getTweetKeys(tweet.quoted_tweet));
    }
    if (tweet.retweeted_tweet) {
        keys.push(...getTweetKeys(tweet.retweeted_tweet));
    }
    if (tweet.entities && tweet.entities.urls) {
        for (const url of tweet.entities.urls) {
            keys.push(url.expanded_url);
        }
    }
    return keys;
}

function getClusters(items: Array<TweetT>) {
    const clusters: Array<Cluster> = [];
    for (const item of items) {
        const keys = getTweetKeys(item);
        let foundCluster = false;
        for (const cluster of clusters) {
            if (setContains(cluster.keys, keys)) {
                foundCluster = true;
                cluster.addItem(item, keys);
            }
        }
        if (!foundCluster) {
            const cluster = new Cluster();
            cluster.addItem(item, keys);
            clusters.push(cluster);
        }
    }
    return clusters;
}

function Tweets(props: { items: Array<any> }) {
    if (props.items.length === 0) {
        return (
            <div className="flex items-center justify-center p-4">No items</div>
        );
    }

    const clusters = useMemo(
        () => getClusters(props.items.map((item) => item.content)),
        [props.items],
    );

    return (
        <div>
            <div className="text-sm text-gray-600 px-4 py-2 bg-gray-100 border-b border-gray-300">
                {props.items.length} tweets
            </div>
            {clusters.map((cluster) => {
                return (
                    <div
                        key={cluster.id}
                        className="border-b-4 border-b-gray-200"
                    >
                        {cluster.getItems().map((item) => {
                            return (
                                <div
                                    key={"tweet-" + item.id}
                                    className="border-b border-b-gray-300"
                                >
                                    <Tweet tweet={item} />
                                </div>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}

export default function Home() {
    const [dateIso, setDateIso] = useQueryParam(
        "date",
        withDefault(
            StringParam,
            toIsoDate(new Date(new Date().getTime() - 24 * 60 * 60 * 1000)),
        ),
    );
    function setDate(date: Date) {
        setDateIso(toIsoDate(date));
    }
    const date = new Date(dateIso);

    const query = useQuery(["items", toIsoDate(date)], () => getItems(date));

    return (
        <>
            <Head>
                <title>Feedpaper</title>
            </Head>
            <main>
                <div className="max-w-[620px] mx-auto border m-2 border-gray-300 bg-white">
                    <div className="p-4 bg-gray-50 border-b border-b-gray-300 flex gap-4">
                        <h3 className="font-semibold text-lg text-gray-800 flex-grow">
                            {date.toLocaleDateString(undefined, {
                                weekday: "long",
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                            })}
                        </h3>
                        <button
                            onClick={() => {
                                setDate(
                                    new Date(
                                        date.getTime() - 24 * 60 * 60 * 1000,
                                    ),
                                );
                            }}
                        >
                            &larr;
                        </button>
                        <button
                            onClick={() => {
                                setDate(
                                    new Date(
                                        date.getTime() + 24 * 60 * 60 * 1000,
                                    ),
                                );
                            }}
                        >
                            &rarr;
                        </button>
                    </div>
                    {query.isLoading && !query.data && (
                        <div className="flex items-center justify-center p-4">
                            Loading...
                        </div>
                    )}
                    {query.data && <Tweets items={query.data.items} />}
                </div>
            </main>
        </>
    );
}
