import fs from "fs";
import terminate from "./terminate";

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

    // TODO: transform response.body into FeedItem[]
    const bodyParsed = JSON.parse(response.body);
    console.log(bodyParsed);

    return [];
}
