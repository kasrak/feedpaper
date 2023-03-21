const fs = require("fs") as typeof import("fs");
const invariant = require("invariant");
const _ = require("lodash");

function getItemsFromEntry(entry) {
    const { content } = entry;
    switch (content.entryType) {
        case "TimelineTimelineModule":
            return content.items.map((item) => ({
                _entryId: entry.entryId,
                _src: "TimelineModule",
                ...item.item.itemContent,
            }));
        case "TimelineTimelineItem":
            return [
                {
                    _entryId: entry.entryId,
                    _src: "TimelineItem",
                    ...content.itemContent,
                },
            ];
        default:
            return [];
    }
}

function getTweetsFromEntries(entries) {
    const items = [];
    for (const entry of entries) {
        for (const item of getItemsFromEntry(entry)) {
            items.push(item);
        }
    }

    const tweets = items
        .filter((item) => item.itemType === "TimelineTweet")
        .map((tweet) => ({
            _entryId: tweet._entryId,
            _src: tweet._src,
            ...tweet.tweet_results.result,
        }));

    return tweets;
}

const log = console.log.bind(console);

function main() {
    const homeTimeline = JSON.parse(
        // fs.readFileSync("./HomeTimeline.json", "utf8"),
        fs.readFileSync("./HomeLatestTimeline.json", "utf8"),
    );

    const instructions =
        homeTimeline.response.body.data.home.home_timeline_urt.instructions;
    invariant(
        instructions.length === 1,
        "unexpected instructions length: %s",
        instructions.length,
    );
    const entries = instructions[0].entries.sort((a, b) =>
        a.sortIndex < b.sortIndex ? 1 : -1,
    );

    const tweets = getTweetsFromEntries(entries);
    for (const tweet of tweets) {
        const userResult = tweet.core.user_results.result;
        const content = {
            id: tweet.rest_id,

            user: {
                id: userResult.rest_id,
                following: userResult.legacy.following,
                name: userResult.legacy.name,
                screen_name: userResult.legacy.screen_name,
            },

            created_at: tweet.legacy.created_at,
            conversation_id: tweet.legacy.conversation_id_str,
            entities: tweet.legacy.entities, // {user_mentions, urls, hashtags, symbols}
            full_text: tweet.legacy.full_text,
            // Long tweets have the full text in the note_tweet.
            note_tweet: tweet.note_tweet?.note_tweet_results.result,

            in_reply_to_screen_name: tweet.legacy.in_reply_to_screen_name,
            in_reply_to_status_id: tweet.legacy.in_reply_to_status_id_str,
            in_reply_to_user_id: tweet.legacy.in_reply_to_user_id_str,
            self_thread: tweet.legacy.self_thread,

            is_quote_status: tweet.legacy.is_quote_status,
            quoted_status_id: tweet.legacy.quoted_status_id_str,
            quoted_status_permalink: tweet.legacy.quoted_status_permalink,
            quoted_status_result: tweet.quoted_status_result?.result,
            retweeted_status_result:
                tweet.legacy.retweeted_status_result?.result,

            lang: tweet.legacy.lang,

            favorite_count: tweet.legacy.favorite_count,
            quote_count: tweet.legacy.quote_count,
            reply_count: tweet.legacy.reply_count,
            retweet_count: tweet.legacy.retweet_count,
        };

        const text = _.unescape(content.full_text);

        // TODO: remove follow up tweets from the same user (only include the first tweet)
        // TODO: include quoted/retweeted tweet text

        log("ID:", content.id);
        log(`@${content.user.screen_name}: ${text}`);
        log("---");
    }
}

main();

/* GPT-4 Prompt:

Below is a list of Tweets, separated by "---". Each Tweet has the format:

ID: <tweet ID>
<username>: <tweet text>

First, generate a list of topics that the Tweets cover. Example:

topics = ["Medicine", "Fitness", "Cooking"]

Then for each topic, return a list of tweet IDs that mention that topic. Example:

tweetsByTopic = {
  "Medicine": [123, 234],
  "Fitness": [456],
  "Cooking": [789, 890],
}

---

*/
