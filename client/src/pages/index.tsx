import Head from "next/head";
import { useQuery } from "react-query";
import Tweet from "@/components/Tweet";
import { useQueryParam, StringParam, withDefault } from "use-query-params";
import { useMemo, useState } from "react";
import { BASE_URL, checkIfPlainRetweet } from "@/helpers";
import { sortBy } from "lodash";

const debugIds: Array<string> = [];

////////////////////////////////////////////////////////////////////////////////
// Data
////////////////////////////////////////////////////////////////////////////////

function toIsoDate(date: Date) {
    const pad = (n: number) => (n < 10 ? `0${n}` : n);
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
        date.getDate(),
    )}`;
}

function normalizeEntity(entity: string) {
    return entity.toLowerCase().replace(/[@\-]/g, "");
}

function setContains<T>(set: Set<T>, array: Array<T>): boolean {
    for (const item of array) {
        if (set.has(item)) {
            return true;
        }
    }
    return false;
}

type TweetT = any;

class CountSet {
    map: Map<string, number> = new Map();
    add(key: string) {
        this.map.set(key, (this.map.get(key) || 0) + 1);
    }
    has(key: string): boolean {
        return this.map.has(key);
    }
    getMostCommon(max: number): Array<string> {
        return this.getEntries()
            .slice(0, max)
            .map((a) => a[0]);
    }
    getEntries(): Array<[string, number]> {
        const entries = Array.from(this.map.entries()).sort(
            (a, b) => b[1] - a[1],
        );
        return entries;
    }
}

let clusterId = 0;
class Cluster {
    id: number;
    keys: Set<string>;
    items: Array<TweetT>;
    mainEntities: CountSet;
    allEntities: CountSet;
    _dedupedItems: Array<TweetT> | null = null;
    constructor() {
        this.id = clusterId++;
        this.keys = new Set();
        this.items = [];
        this.mainEntities = new CountSet();
        this.allEntities = new CountSet();
    }
    addItem(item: TweetT, keys: Array<string>) {
        this._dedupedItems = null;
        this.items.push(item);
        for (const key of keys) {
            this.keys.add(key);
        }

        if (item.enrichment) {
            const { mainEntity, entities } = item.enrichment;
            if (mainEntity) {
                this.mainEntities.add(normalizeEntity(mainEntity));
            }
            for (const entity of entities) {
                this.allEntities.add(normalizeEntity(entity));
            }
        }
    }
    getItems(): Array<TweetT> {
        if (!this._dedupedItems) {
            const allItems = sortBy(
                this.items,
                (item) => `${new Date(item.created_at).getTime()}${item.id}`,
            );
            const dedupedItems: Array<TweetT> = [];
            const ids = new Set<string>();
            for (const item of allItems) {
                // filter out retweets if original tweet is in items
                if (
                    item.retweeted_tweet &&
                    ids.has(item.retweeted_tweet.id) &&
                    checkIfPlainRetweet(item)
                ) {
                    continue;
                }
                dedupedItems.push(item);
                ids.add(item.id);
            }
            this._dedupedItems = dedupedItems;
        }
        return this._dedupedItems;
    }
    getUserCount(): number {
        return new Set(this.items.flatMap((item) => getTweetUsers(item))).size;
    }
    toString(): string {
        return JSON.stringify(this.mainEntities.getEntries());
    }
}

class ClusterGraph {
    nodes: Map<Cluster, Map<Cluster, number>>;

    constructor() {
        this.nodes = new Map();
    }

    addNode(cluster: Cluster): void {
        if (!this.nodes.has(cluster)) {
            this.nodes.set(cluster, new Map());
        }
    }

    addEdge(clusterA: Cluster, clusterB: Cluster, weight: number): void {
        this.nodes.get(clusterA)!.set(clusterB, weight);
        this.nodes.get(clusterB)!.set(clusterA, weight);
    }

    getNeighbors(cluster: Cluster): Map<Cluster, number> | undefined {
        return this.nodes.get(cluster);
    }
}

function dfs(
    cluster: Cluster,
    graph: ClusterGraph,
    unvisited: Set<Cluster>,
    sortedClusters: Array<Cluster>,
): void {
    unvisited.delete(cluster);
    sortedClusters.push(cluster);

    const neighbors = Array.from(graph.getNeighbors(cluster)!.entries()).sort(
        (a, b) => b[1] - a[1],
    );

    for (const [nextCluster] of neighbors) {
        if (unvisited.has(nextCluster)) {
            dfs(nextCluster, graph, unvisited, sortedClusters);
        }
    }
}

function assert(truthy: any, message: string) {
    if (!truthy) {
        throw new Error(message);
    }
}

export function getTweetKeys(tweet: TweetT): Array<string> {
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

function getTweetUsers(tweet: TweetT): Array<string> {
    const users = [tweet.user.screen_name];
    if (tweet.retweeted_tweet) {
        users.push(tweet.retweeted_tweet.user.screen_name);
    }
    if (tweet.quoted_tweet) {
        users.push(tweet.quoted_tweet.user.screen_name);
    }
    return users;
}

function getSimilarity(a: Cluster, b: Cluster) {
    let similarity = 0;
    for (const [mainEntity] of a.mainEntities.getEntries()) {
        if (b.mainEntities.has(mainEntity)) {
            similarity += 10;
        }
    }
    for (const [entity] of a.allEntities.getEntries()) {
        if (b.allEntities.has(entity)) {
            similarity += 1;
        }
    }
    // todo: subset words in entities
    // todo: subset words in texts
    // todo: weight by number of entities?
    return similarity;
}

function getClusters(items: Array<TweetT>) {
    let clusters: Array<Cluster> = [];
    for (const item of items) {
        const keys = getTweetKeys(item);
        let foundCluster = false;
        for (const cluster of clusters) {
            if (setContains(cluster.keys, keys)) {
                foundCluster = true;
                cluster.addItem(item, keys);
                break;
            }
        }
        if (!foundCluster) {
            const cluster = new Cluster();
            clusters.push(cluster);
            cluster.addItem(item, keys);
        }
    }

    // First sort by number of users involved as an initial heuristic
    // for interestingness (although this should be more based on
    // length of unique users involved in a cluster...)
    clusters = sortBy(clusters, (cluster) => -cluster.getUserCount());

    // Now order clusters so related clusters are closer together.
    const graph = new ClusterGraph();
    for (const cluster of clusters) {
        graph.addNode(cluster);
    }
    for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
            const similarity = getSimilarity(clusters[i], clusters[j]);
            if (similarity > 0) {
                graph.addEdge(clusters[i], clusters[j], similarity);
            }
        }
    }
    const unvisited = new Set<Cluster>(graph.nodes.keys());
    const sortedClusters: Array<Cluster> = [];
    while (unvisited.size > 0) {
        // kinda inefficient, but we want to "stable sort" so that
        // between similar cluster groups, we go back to the original
        // interestingness order.
        const remainingClusters = clusters.filter((c) => unvisited.has(c));
        dfs(remainingClusters[0], graph, unvisited, sortedClusters);
    }

    return sortedClusters;
}

////////////////////////////////////////////////////////////////////////////////
// UI
////////////////////////////////////////////////////////////////////////////////

async function getItems(date: Date) {
    const start = toIsoDate(new Date(date.getTime() - 24 * 60 * 60 * 1000));
    const end = toIsoDate(date);
    const res = await fetch(`${BASE_URL}/getItems?start=${start}&end=${end}`);
    return res.json();
}

function ClusterTweets(props: {
    cluster: Cluster;
    onDebugCluster: (cluster: Cluster) => void;
}) {
    const { cluster } = props;

    const items = useMemo(() => cluster.getItems(), [cluster]);

    const itemsToShowWhenCollapsed = 2;
    const [expanded, setExpanded] = useState(() => {
        return items.length <= 2;
    });

    const mainEntitiesSet = new Set(
        cluster.mainEntities.getEntries().map(([entity]) => entity),
    );

    return (
        <div key={cluster.id}>
            <div
                className="bg-gray-200 h-1"
                onDoubleClick={() => {
                    props.onDebugCluster(cluster);
                }}
            >
                <div className="relative left-[-200px] w-[200px] text-gray-600">
                    <div className="font-semibold">
                        {cluster.mainEntities
                            .getEntries()
                            .map(([entity, count]) => entity)
                            .join(", ")}
                    </div>
                    <div>
                        {cluster.allEntities
                            .getEntries()
                            .map(([entity, count]) => entity)
                            .filter((entity) => !mainEntitiesSet.has(entity))
                            .join(", ")}
                    </div>
                </div>
            </div>
            {(expanded ? items : items.slice(0, itemsToShowWhenCollapsed)).map(
                (item) => {
                    return (
                        <div
                            key={"tweet-" + item.id}
                            className="border-b border-b-gray-300"
                        >
                            <Tweet tweet={item} />
                        </div>
                    );
                },
            )}
            {!expanded && (
                <div>
                    <button
                        className="font-semibold text-sky-600 px-4 py-2"
                        onClick={() => setExpanded(true)}
                    >
                        Show {items.length - itemsToShowWhenCollapsed} more...
                    </button>
                </div>
            )}
        </div>
    );
}

function Tweets(props: { items: Array<TweetT> }) {
    if (props.items.length === 0) {
        return (
            <div className="flex items-center justify-center p-4">No items</div>
        );
    }

    const clusters = useMemo(() => {
        return getClusters(
            props.items.map((item) => ({
                ...item.content,
                enrichment: item.enrichment,
            })),
        );
    }, [props.items]);

    const debugCluster = (cluster: Cluster) => {
        const clustersWithSimilarity = sortBy(
            clusters.map((c) => [getSimilarity(cluster, c), c] as const),
            (c) => -c[0],
        );
        console.log(
            "main entities",
            JSON.stringify(cluster.mainEntities.getEntries()),
        );
        console.log(
            "all entities",
            JSON.stringify(cluster.allEntities.getEntries()),
        );
        console.log("user count", cluster.getUserCount());
        console.log("related clusters:");
        console.table(
            clustersWithSimilarity
                .filter(([similarity]) => similarity > 0)
                .map(([similarity, cluster]) => {
                    return [similarity, cluster.toString()];
                }),
        );
    };

    return (
        <div>
            <div className="text-sm text-gray-600 px-4 py-2 bg-gray-100 border-b border-gray-300">
                {props.items.length} tweets
            </div>
            {clusters.map((cluster) => {
                return (
                    <ClusterTweets
                        key={cluster.getItems()[0].id}
                        cluster={cluster}
                        onDebugCluster={debugCluster}
                    />
                );
            })}
        </div>
    );
}

export default function Home() {
    const [dateIso, setDateIso] = useQueryParam(
        "date",
        withDefault(StringParam, toIsoDate(new Date())),
    );
    function setDate(date: Date) {
        setDateIso(toIsoDate(date));
    }
    // HACK: this will be off-by-1 for some timezones I think
    const date = new Date(dateIso + "T00:00:00");

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
                    {query.data && (
                        <Tweets
                            items={query.data.items.filter((item: any) =>
                                debugIds.length
                                    ? debugIds.includes(item.content.id)
                                    : true,
                            )}
                        />
                    )}
                </div>
            </main>
        </>
    );
}
