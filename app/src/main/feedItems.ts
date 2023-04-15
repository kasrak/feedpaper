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

export async function saveFeedItemsFromResponse(
    response: {
        base64Encoded: boolean;
        body: string;
    },
    serverBaseUrl: string,
): Promise<Array<FeedItem>> {
    if (response.base64Encoded) {
        terminate("Response body is unexpectedly base64 encoded");
    }

    const bodyParsed = JSON.parse(response.body);
    let items = getTweetsFromInstructions(
        bodyParsed.data.home.home_timeline_urt.instructions,
    );

    const res = await fetch(`${serverBaseUrl}/api/saveItems`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({
            items,
        }),
    });

    if (res.ok) {
        console.log(`Saved ${items.length} tweets`);
    } else {
        console.error("Failed to save tweets:", res.status, res.statusText);
    }

    return [];
}
