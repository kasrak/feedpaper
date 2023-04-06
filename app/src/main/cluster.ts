const { sortBy } = require("lodash");

// TODO: Dedupe function
function checkIfPlainRetweet(tweet: any): boolean {
    const result =
        tweet.retweeted_tweet &&
        tweet.full_text.startsWith(
            `RT @${tweet.retweeted_tweet.user.screen_name}: `,
        );
    return result;
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
        const allItems = sortBy(this.items, (item) =>
            new Date(item.created_at).getTime(),
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

        return dedupedItems;
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
    if (tweet.entities && tweet.entities.hashtags) {
        for (const hashtag of tweet.entities.hashtags) {
            keys.push(hashtag.text.toLowerCase());
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
                break;
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

module.exports = {
    getClusters,
    Cluster,
};
