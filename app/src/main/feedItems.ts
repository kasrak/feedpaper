import util from "util";
import terminate from "./terminate";
import { getTweetsFromInstructions } from "./twitterUtils";

// https://chromedevtools.github.io/devtools-protocol/tot/Network/#type-Response
type Response = {
    url: string;
    status: number;
    statusText: string;
};

// https://chromedevtools.github.io/devtools-protocol/tot/Network/#event-responseReceived
type ResponseReceivedParams = {
    requestId: string;
    type: string;
    response: Response;
};

export type FeedItem = any; // TODO: type

const requestUrlsToWatch = [
    "/HomeLatestTimeline",
    "/HomeTimeline",
    "/ListLatestTweetsTimeline",
];
export function shouldWatchRequest(request: ResponseReceivedParams) {
    return (
        request.type !== "Preflight" &&
        requestUrlsToWatch.some((url) => request.response.url.includes(url))
    );
}

export function getFeedItemsFromResponse(
    request: ResponseReceivedParams,
    response: {
        base64Encoded: boolean;
        body: string;
    },
): Array<FeedItem> {
    if (response.base64Encoded) {
        terminate("Response body is unexpectedly base64 encoded");
    }

    const bodyParsed = JSON.parse(response.body);
    let tweets = getTweetsFromInstructions(
        bodyParsed.data.home.home_timeline_urt.instructions,
    );

    tweets = tweets.filter((tweet) => {
        return (
            // Remove self_replies
            (!tweet.self_thread || tweet.self_thread.id_str === tweet.id) &&
            // Remove promoted tweets
            !tweet._isPromoted
        );
    });

    for (const tweet of tweets) {
        if (tweet.quoted_tweet) {
            console.log(util.inspect(tweet, { depth: 10 }));
        }
    }

    return [];
}
