import Head from "next/head";
import { useQuery } from "react-query";
import Tweet from "@/components/Tweet";
import { useQueryParam, StringParam, withDefault } from "use-query-params";
import { useMemo, useRef, useState } from "react";
import { BASE_URL } from "@/utils/base_url";
import { checkIfPlainRetweet, getTweetCard } from "@/utils/twitter";
import { sortBy } from "lodash";
import { useLocalStorageState } from "@/utils/hooks";
import Settings from "@/components/Settings";
import {
    ArrowLeftIcon,
    ArrowRightIcon,
    Cog6ToothIcon,
} from "@heroicons/react/20/solid";

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
    // remove @ to merge mentions and names (e.g. @google and google)
    // remove - to merge multi-word names (e.g. WebLLM and Web-LLM)
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

// TODO: add type
type ConversationItem = any;

class CountSet {
    _map: Map<string, number> = new Map();
    add(key: string) {
        this._map.set(key, (this._map.get(key) || 0) + 1);
    }
    has(key: string): boolean {
        return this._map.has(key);
    }
    getMostCommon(max: number): Array<string> {
        return this.getEntries()
            .slice(0, max)
            .map((a) => a[0]);
    }
    getEntries(): Array<[string, number]> {
        const entries = Array.from(this._map.entries()).sort(
            (a, b) => b[1] - a[1],
        );
        return entries;
    }
    filter(fn: (entry: [key: string, count: number]) => boolean): CountSet {
        const newSet = new CountSet();
        for (const entry of this.getEntries()) {
            if (fn(entry)) {
                newSet.add(entry[0]);
            }
        }
        return newSet;
    }
    map(fn: (entry: [key: string, count: number]) => any): Array<any> {
        return this.getEntries().map(fn);
    }
    get size(): number {
        return this._map.size;
    }
}

let conversationId = 0;
// A Conversation is a set of related  that are all talking about the same
// thing
class Conversation {
    id: number;

    items: Array<ConversationItem>;
    itemIds: Set<string>;

    keys: Set<string>;
    mainEntities: CountSet;
    allEntities: CountSet;

    _dedupedItems: Array<ConversationItem> | null = null;
    constructor() {
        this.id = conversationId++;

        this.items = [];
        this.itemIds = new Set();

        this.keys = new Set();
        this.mainEntities = new CountSet();
        this.allEntities = new CountSet();
    }
    addItem(item: ConversationItem, keys: Array<string>) {
        if (this.itemIds.has(item.id)) {
            return;
        }

        this._dedupedItems = null;

        this.itemIds.add(item.id);
        this.items.push(item);
        for (const key of keys) {
            this.keys.add(key);
        }

        if (item.enrichment) {
            const { main_entity: mainEntity, entities } = item.enrichment;
            if (mainEntity) {
                this.mainEntities.add(normalizeEntity(mainEntity));
            }
            for (const entity of entities) {
                const normalizedEntity = normalizeEntity(entity);
                if (normalizedEntity !== "qt") {
                    this.allEntities.add(normalizedEntity);
                }
            }
        }
    }
    merge(otherConversation: Conversation) {
        for (const item of otherConversation.items) {
            this.addItem(item, Array.from(otherConversation.keys));
        }
    }
    getItems(): Array<ConversationItem> {
        if (!this._dedupedItems) {
            const allItems = sortBy(
                this.items,
                (item) => `${new Date(item.created_at).getTime()}${item.id}`,
            );
            const dedupedItems: Array<ConversationItem> = [];
            const dedupedItemsById: Map<string, ConversationItem> = new Map();
            for (const item of allItems) {
                // filter out retweets if original tweet is in items
                if (
                    item.retweeted_tweet &&
                    dedupedItemsById.has(item.retweeted_tweet.id) &&
                    checkIfPlainRetweet(item)
                ) {
                    const originalTweet = dedupedItemsById.get(
                        item.retweeted_tweet.id,
                    )!;
                    if (originalTweet.retweeted_by) {
                        originalTweet.retweeted_by.push(item.user);
                    } else {
                        originalTweet.retweeted_by = [item.user];
                    }
                } else {
                    // Make a copy because we might modify item.retweeted_by if
                    // we encounter retweets.
                    const itemCopy = { ...item };
                    dedupedItemsById.set(item.id, itemCopy);
                    dedupedItems.push(itemCopy);
                }
            }
            this._dedupedItems = dedupedItems;
        }
        return this._dedupedItems;
    }
    getSources(): CountSet {
        const sources = new CountSet();
        for (const item of this.items) {
            const itemSources = getTweetUsers(item);
            for (const source of itemSources) {
                sources.add(source.screen_name);
            }
        }
        return sources;
    }
    getFollowedSources(): Set<string> {
        const sources = new Set<string>();
        for (const item of this.items) {
            const itemSources = getTweetUsers(item);
            for (const source of itemSources) {
                if (source.following) {
                    sources.add(source.screen_name);
                }
            }
        }
        return sources;
    }
    getRelevance(): number {
        const relevances = this.items.map(
            (item) => item.enrichment?.relevance || 0,
        );
        // if no items have a relevance, return 5 by default
        return Math.max(...relevances) || 5;
    }
    getUpvotes(): number {
        return this.items.reduce(
            (sum, item) => sum + item.favorite_count + item.retweet_count,
            0,
        );
    }
    toString(): string {
        return JSON.stringify(this.mainEntities.getEntries());
    }
}

class ConversationGraph {
    nodes: Map<Conversation, Map<Conversation, number>>;

    constructor() {
        this.nodes = new Map();
    }

    addNode(conversation: Conversation): void {
        if (!this.nodes.has(conversation)) {
            this.nodes.set(conversation, new Map());
        }
    }

    addEdge(a: Conversation, b: Conversation, weight: number): void {
        this.nodes.get(a)!.set(b, weight);
        this.nodes.get(b)!.set(a, weight);
    }

    getNeighbors(
        conversation: Conversation,
    ): Map<Conversation, number> | undefined {
        return this.nodes.get(conversation);
    }
}

function dfs(
    conversation: Conversation,
    graph: ConversationGraph,
    unvisited: Set<Conversation>,
    sortedConversations: Array<Conversation>,
): void {
    unvisited.delete(conversation);
    sortedConversations.push(conversation);

    const neighbors = Array.from(
        graph.getNeighbors(conversation)!.entries(),
    ).sort((a, b) => b[1] - a[1]);

    for (const [nextConversation] of neighbors) {
        if (unvisited.has(nextConversation)) {
            dfs(nextConversation, graph, unvisited, sortedConversations);
        }
    }
}

function getSimilarity(a: Conversation, b: Conversation) {
    let similarity = 0;

    const aMainStr = a.mainEntities
        .getEntries()
        .map((e) => e[0])
        .join(" ");
    const bMainStr = b.mainEntities
        .getEntries()
        .map((e) => e[0])
        .join(" ");
    for (const [mainEntity] of a.mainEntities.getEntries()) {
        if (b.mainEntities.has(mainEntity)) {
            similarity += 10;
        } else if (bMainStr.includes(mainEntity)) {
            similarity += 3;
        }
    }
    for (const [mainEntity] of b.mainEntities.getEntries()) {
        if (aMainStr.includes(mainEntity)) {
            similarity += 3;
        }
    }
    for (const [entity] of a.allEntities.getEntries()) {
        if (b.mainEntities.has(entity)) {
            similarity += 2;
        } else if (b.allEntities.has(entity)) {
            similarity += 1;
        }
    }
    // todo: subset words in texts?
    // todo: weight by number of entities?
    return similarity;
}

export function getTweetKeys(tweet: ConversationItem): Array<string> {
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
    const tweetCard = getTweetCard(tweet);
    if (tweetCard) {
        // this helps with tweets that link to the same thing, but use
        // different url shorteners.
        const domain = tweetCard.attributes.get("domain");
        const title = tweetCard.attributes.get("title");
        if (domain && title) {
            keys.push(`${domain.string_value}:${title.string_value}`);
        }
    }
    return keys;
}

function getTweetUsers(
    tweet: ConversationItem,
): Array<{ screen_name: string; following: boolean }> {
    const users = [tweet.user];
    if (tweet.retweeted_tweet) {
        users.push(tweet.retweeted_tweet.user);
    }
    if (tweet.quoted_tweet) {
        users.push(tweet.quoted_tweet.user);
    }
    return users;
}

function getConversations(items: Array<ConversationItem>) {
    let conversations: Array<Conversation> = [];
    for (const item of items) {
        const keys = getTweetKeys(item);
        let foundConversation: Conversation | undefined;
        for (const conversation of conversations) {
            if (setContains(conversation.keys, keys)) {
                foundConversation = conversation;
                break;
            }
        }
        if (!foundConversation) {
            foundConversation = new Conversation();
            conversations.push(foundConversation);
        }
        if (item.retweeted_tweet) {
            foundConversation.addItem(item.retweeted_tweet, keys);
        }
        if (item.quoted_tweet) {
            foundConversation.addItem(item.quoted_tweet, keys);
        }
        foundConversation.addItem(item, keys);
    }

    // Because we create conversations greedily, we sometimes end up with
    // conversations getting split. E.g. conversations [a], [b] get created.
    // Then c comes along referencing both a, and b. It will arbitrarily
    // end up in one of the two conversations. Now we need to merge them.
    for (let i = 0; i < conversations.length; i++) {
        const conversation = conversations[i];
        const conversationKeys = Array.from(conversation.keys);
        for (let j = i + 1; j < conversations.length; j++) {
            const otherConversation = conversations[j];
            if (setContains(otherConversation.keys, conversationKeys)) {
                conversation.merge(otherConversation);
                conversations.splice(j, 1);
                j--;
            }
        }
    }

    // First sort by number of users involved as an initial heuristic for
    // interestingness.
    conversations = sortBy(
        conversations,
        (conversation) =>
            -(
                // double-count followed sources deliberately
                (
                    conversation.getSources().size +
                    conversation.getFollowedSources().size
                )
            ) * conversation.getRelevance(),
    );

    // Filter out low relevance conversations
    const hiddenConversations: Array<Conversation> = [];
    conversations = conversations.filter((conversation) => {
        if (conversation.getRelevance() > 2) {
            return true;
        }
        if (conversation.getFollowedSources().size > 0) {
            return true;
        }
        if (conversation.getUpvotes() > 1000) {
            return true;
        }
        hiddenConversations.push(conversation);
        return false;
    });

    // Now order so related conversations are closer together.
    const graph = new ConversationGraph();
    for (const conversation of conversations) {
        graph.addNode(conversation);
    }
    for (let i = 0; i < conversations.length; i++) {
        for (let j = i + 1; j < conversations.length; j++) {
            const similarity = getSimilarity(
                conversations[i],
                conversations[j],
            );
            if (similarity > 0) {
                graph.addEdge(conversations[i], conversations[j], similarity);
            }
        }
    }
    const unvisited = new Set<Conversation>(graph.nodes.keys());
    const sortedConversations: Array<Conversation> = [];
    while (unvisited.size > 0) {
        // kinda inefficient, but we want to "stable sort" so that
        // between similar conversation groups, we go back to the original
        // interestingness order.
        const remainingConversations = conversations.filter((c) =>
            unvisited.has(c),
        );
        dfs(remainingConversations[0], graph, unvisited, sortedConversations);
    }

    return { sortedConversations, hiddenConversations };
}

////////////////////////////////////////////////////////////////////////////////
// UI
////////////////////////////////////////////////////////////////////////////////

async function getItems(date: Date) {
    const start = toIsoDate(new Date(date.getTime() - 24 * 60 * 60 * 1000));
    const end = toIsoDate(date);
    const res = await fetch(
        `${BASE_URL}/api/getItems?start=${start}&end=${end}`,
    );
    return res.json();
}

function ConversationItems(props: {
    conversation: Conversation;
    isDebug: boolean;
    onDebugConversation: (conversation: Conversation) => void;
}) {
    const { conversation } = props;

    const items = useMemo(() => conversation.getItems(), [conversation]);

    const itemsToShowWhenCollapsed = 2;
    const shouldShowExpandButton = items.length > itemsToShowWhenCollapsed;
    const [expanded, setExpanded] = useState(() => {
        return items.length <= 2;
    });
    const pageScrollYRef = useRef(0);
    const itemsToShow = expanded
        ? items
        : items.slice(0, itemsToShowWhenCollapsed);
    const visibleSources = new Set(
        itemsToShow.flatMap((item) =>
            getTweetUsers(item).map((user) => user.screen_name),
        ),
    );

    const mainEntitiesSet = new Set(
        conversation.mainEntities.getEntries().map(([entity]) => entity),
    );

    return (
        <div key={conversation.id}>
            <div
                className="bg-gray-200 h-1"
                onDoubleClick={() => {
                    props.onDebugConversation(conversation);
                }}
            >
                {props.isDebug && (
                    <div className="relative left-[-212px] w-[200px] text-gray-600 overflow-auto font-mono text-xs">
                        <div className="font-semibold">
                            {conversation.mainEntities
                                .getEntries()
                                .map(([entity, count]) => entity)
                                .join(", ")}
                        </div>
                        <div>
                            {conversation.allEntities
                                .getEntries()
                                .map(([entity, count]) => entity)
                                .filter(
                                    (entity) => !mainEntitiesSet.has(entity),
                                )
                                .join(", ")}
                        </div>
                        <div>relevance: {conversation.getRelevance()}</div>
                        <div>upvotes: {conversation.getUpvotes()}</div>
                        <div>
                            following: {conversation.getFollowedSources().size}
                        </div>
                    </div>
                )}
            </div>
            {itemsToShow.map((item) => {
                return (
                    <div
                        key={"tweet-" + item.id}
                        className="border-b border-b-gray-300"
                    >
                        <Tweet tweet={item} isDebug={props.isDebug} />
                    </div>
                );
            })}
            {shouldShowExpandButton &&
                (expanded ? (
                    <div
                        className="bg-white sticky bottom-0"
                        style={{ boxShadow: "0 -1px #ddd" }}
                    >
                        <button
                            className="font-semibold text-sky-600 px-4 py-2"
                            onClick={() => {
                                setExpanded(false);
                                window.scrollTo({
                                    top: pageScrollYRef.current,
                                });
                            }}
                        >
                            Show less
                        </button>
                    </div>
                ) : (
                    <div>
                        <button
                            className="flex items-center px-4 py-2 overflow-hidden w-full text-left"
                            onClick={() => {
                                pageScrollYRef.current = window.scrollY;
                                setExpanded(true);
                            }}
                        >
                            <span className="font-semibold text-sky-600 flex-grow whitespace-nowrap mr-4">
                                Show {items.length - itemsToShowWhenCollapsed}{" "}
                                more...
                            </span>
                            <span className="truncate text-sm text-gray-400">
                                {conversation
                                    .getSources()
                                    .filter(
                                        ([source]) =>
                                            !visibleSources.has(source),
                                    )
                                    .map(([source]) => `@${source}`)
                                    .join(", ")}
                            </span>
                        </button>
                    </div>
                ))}
        </div>
    );
}

function ConversationsList(props: {
    items: Array<ConversationItem>;
    isDebug: boolean;
}) {
    const { sortedConversations, hiddenConversations } = useMemo(() => {
        return getConversations(
            props.items.map((item) => ({
                ...item.content,
                enrichment: item.enrichment,
            })),
        );
    }, [props.items]);
    const [showHiddenConversations, setShowHiddenConversations] =
        useState(false);

    if (props.items.length === 0) {
        return (
            <div className="flex items-center justify-center p-4">No items</div>
        );
    }

    const debugConversation = (conversation: Conversation) => {
        const similarConversations = sortBy(
            sortedConversations.map(
                (c) => [getSimilarity(conversation, c), c] as const,
            ),
            (c) => -c[0],
        );
        console.log(
            "main entities",
            JSON.stringify(conversation.mainEntities.getEntries()),
        );
        console.log(
            "all entities",
            JSON.stringify(conversation.allEntities.getEntries()),
        );
        console.log("user count", conversation.getSources());
        console.log("related conversations:");
        console.table(
            similarConversations
                .filter(([similarity]) => similarity > 0)
                .map(([similarity, conversation]) => {
                    return [similarity, conversation.toString()];
                }),
        );
    };

    return (
        <div>
            <div className="text-sm text-gray-600 px-4 py-2 bg-gray-100 border-b border-gray-300">
                {props.items.length} tweets
            </div>
            {sortedConversations.map((conversation) => {
                return (
                    <ConversationItems
                        key={conversation.getItems()[0].id}
                        conversation={conversation}
                        isDebug={props.isDebug}
                        onDebugConversation={debugConversation}
                    />
                );
            })}
            {hiddenConversations.length > 0 && (
                <div className="border-t border-gray-300 text-gray-500 ">
                    {showHiddenConversations ? (
                        hiddenConversations.map((conversation) => {
                            return (
                                <ConversationItems
                                    key={conversation.getItems()[0].id}
                                    conversation={conversation}
                                    isDebug={props.isDebug}
                                    onDebugConversation={debugConversation}
                                />
                            );
                        })
                    ) : (
                        <div className="p-4">
                            Saved you from reading {hiddenConversations.length}{" "}
                            low relevance conversations.{" "}
                            <button
                                className="text-sky-600"
                                onClick={() => setShowHiddenConversations(true)}
                            >
                                Show
                            </button>
                        </div>
                    )}
                </div>
            )}
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
    const date = new Date(dateIso + "T00:00:00");

    const query = useQuery({
        queryKey: ["items", dateIso],
        queryFn: () => getItems(date),
        refetchOnWindowFocus: false,
    });

    const [isDebug, setIsDebug] = useLocalStorageState("isDebug", false);
    const [showSettings, setShowSettings] = useState(false);

    return (
        <>
            <Head>
                <title>Feedpaper</title>
            </Head>
            <main>
                <div className="max-w-[620px] mx-auto border m-2 border-gray-300 bg-white">
                    <div className="p-4 bg-gray-50 border-b border-b-gray-300 flex gap-4 sticky top-0 z-10">
                        <h3 className="font-semibold text-base text-gray-800 flex-grow">
                            {date.toLocaleDateString(undefined, {
                                weekday: "long",
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                            })}
                        </h3>
                        <label className="flex gap-1 items-center text-gray-600 mr-1 select-none">
                            <input
                                type="checkbox"
                                checked={isDebug}
                                onChange={(e) => setIsDebug(e.target.checked)}
                            />
                            Debug
                        </label>
                        <button className="mr-1 text-gray-900 hover:text-sky-600">
                            <Cog6ToothIcon className="w-4 h-4" />
                        </button>
                        <button
                            className="text-gray-900 hover:text-sky-600"
                            onClick={() => {
                                setDate(
                                    new Date(
                                        date.getTime() - 24 * 60 * 60 * 1000,
                                    ),
                                );
                            }}
                        >
                            <ArrowLeftIcon className="w-4 h-4" />
                        </button>
                        <button
                            className="text-gray-900 hover:text-sky-600"
                            onClick={() => {
                                setDate(
                                    new Date(
                                        date.getTime() + 24 * 60 * 60 * 1000,
                                    ),
                                );
                            }}
                        >
                            <ArrowRightIcon className="w-4 h-4" />
                        </button>
                    </div>
                    {query.isLoading && !query.data && (
                        <div className="flex items-center justify-center p-4">
                            Loading...
                        </div>
                    )}
                    {query.data && (
                        <ConversationsList
                            items={query.data.items}
                            isDebug={isDebug}
                        />
                    )}
                </div>
                <Settings
                    open={showSettings}
                    onOpenChange={(isOpen) => {
                        setShowSettings(isOpen);
                    }}
                />
            </main>
        </>
    );
}
