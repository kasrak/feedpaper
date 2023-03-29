import unescape from "lodash/unescape";
import { invariant } from "ts-invariant";

function getItemsFromEntry(entry) {
    if (!entry) {
        return [];
    }
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

function formatTweet(rawTweet) {
    if (!rawTweet) {
        return rawTweet;
    }

    if (rawTweet.__typename === "TweetWithVisibilityResults") {
        rawTweet = rawTweet.tweet;
    }

    const userResult = rawTweet.core.user_results.result;
    const tweet = {
        id: rawTweet.rest_id,

        is_promoted: rawTweet._isPromoted,

        user: {
            id: userResult.rest_id,
            following: userResult.legacy.following,
            name: userResult.legacy.name,
            screen_name: userResult.legacy.screen_name,
        },

        created_at: rawTweet.legacy.created_at,
        conversation_id: rawTweet.legacy.conversation_id_str,
        entities: rawTweet.legacy.entities, // {user_mentions, urls, hashtags, symbols}
        extended_entities: rawTweet.legacy.extended_entities,
        full_text: unescape(rawTweet.legacy.full_text),
        // Long tweets have the full text in the note_tweet.
        note_tweet: rawTweet.note_tweet?.note_tweet_results.result,

        card: rawTweet.card,

        in_reply_to_screen_name: rawTweet.legacy.in_reply_to_screen_name,
        in_reply_to_status_id: rawTweet.legacy.in_reply_to_status_id_str,
        in_reply_to_user_id: rawTweet.legacy.in_reply_to_user_id_str,
        self_thread: rawTweet.legacy.self_thread,

        quoted_tweet: formatTweet(rawTweet.quoted_status_result?.result),
        retweeted_tweet: formatTweet(
            rawTweet.legacy.retweeted_status_result?.result,
        ),

        lang: rawTweet.legacy.lang,

        favorite_count: rawTweet.legacy.favorite_count,
        quote_count: rawTweet.legacy.quote_count,
        reply_count: rawTweet.legacy.reply_count,
        retweet_count: rawTweet.legacy.retweet_count,
    };

    return tweet;
}

function getTweetsFromEntries(entries) {
    const items = [];
    for (const entry of entries) {
        for (const item of getItemsFromEntry(entry)) {
            items.push(item);
        }
    }

    const rawTweets = items
        .filter((item) => item.itemType === "TimelineTweet")
        .map((item) => ({
            _entryId: item._entryId,
            _src: item._src,
            _isPromoted: !!item.promotedMetadata,
            ...item.tweet_results.result,
        }));

    const tweets = rawTweets
        .map((rawTweet) => {
            try {
                return formatTweet(rawTweet);
            } catch (err) {
                console.error("Failed to parse tweet", err, rawTweet);
                return null;
            }
        })
        .filter((tweet) => tweet);

    return tweets;
}

export function formatTweetForPrompt(tweet) {
    // entities.media (alt text)
    // card.legacy.binding_values[key={description, domain, title}]
    return JSON.stringify({}, null, 1);
}

export function getTweetsFromInstructions(instructions) {
    const entries = instructions
        .flatMap((instruction) => instruction.entries)
        .sort((a, b) => (a.sortIndex < b.sortIndex ? 1 : -1));

    const tweets = getTweetsFromEntries(entries);

    return tweets;
}
