import util from "util";
import terminate from "./terminate";
import { getTweetsFromInstructions } from "./twitterUtils";
import fetch from "node-fetch";

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

export async function getFeedItemsFromResponse(
    request: ResponseReceivedParams,
    response: {
        base64Encoded: boolean;
        body: string;
    },
): Promise<Array<FeedItem>> {
    if (response.base64Encoded) {
        terminate("Response body is unexpectedly base64 encoded");
    }

    const bodyParsed = JSON.parse(response.body);
    let tweets = getTweetsFromInstructions(
        bodyParsed.data.home.home_timeline_urt.instructions,
    );

    const res = await fetch("http://0.0.0.0:8888", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            cmd: "saveTweets",
            args: {
                tweets,
            },
        }),
    });

    if (res.ok) {
        console.log(`Saved ${tweets.length} tweets`);
    } else {
        console.error("Failed to save tweets:", res.status, res.statusText);
    }

    return [];
}
