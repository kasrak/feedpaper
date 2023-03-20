export {};

// Install alarm after extension is installed
chrome.runtime.onInstalled.addListener(() => {
    chrome.alarms.create("refresh", { periodInMinutes: 1 });
});

// Listen for alarm
chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "refresh") {
        // const now = Date.now();
        // console.log("Alarm fired!", {
        //     now,
        //     scheduled: alarm.scheduledTime,
        //     drift: now - alarm.scheduledTime,
        // });
        // refresh();
    }
});

const requestUrlsToWatch = [
    "/HomeLatestTimeline",
    "/HomeTimeline",
    "/ListLatestTweetsTimeline",
];
function shouldWatchRequestUrl(requestUrl: string) {
    return requestUrlsToWatch.some((url) => requestUrl.includes(url));
}

function getTweets(instructions: Array<any>) {
    const tweets = instructions
        .filter((instruction) => instruction.type === "TimelineAddEntries")
        .flatMap((instruction) => instruction.entries)
        .sort((a, b) => (a.sortIndex < b.sortIndex ? 1 : -1))
        .map((entry) => entry.content);
    return tweets;
}

let requestBodyById = new Map();

async function refresh() {
    const tab = await chrome.tabs.create({
        url: "https://www.twitter.com",
        active: false,
    });

    // Listen for relevant API calls
    const webRequestFilters = {
        tabId: tab.id,
        urls: ["https://twitter.com/i/api/*"],
    };
    chrome.webRequest.onBeforeRequest.addListener(
        (details) => {
            if (shouldWatchRequestUrl(details.url)) {
                if (details.method !== "GET") {
                    let requestBody: string | void = undefined;
                    if (details.requestBody.raw) {
                        requestBody = new TextDecoder().decode(
                            details.requestBody.raw[0].bytes,
                        );
                    }

                    requestBodyById.set(details.requestId, requestBody);
                    console.log(`set body[${details.requestId}]:`, requestBody);
                }
            }
        },
        webRequestFilters,
        ["requestBody"],
    );
    chrome.webRequest.onBeforeSendHeaders.addListener(
        (details) => {
            if (shouldWatchRequestUrl(details.url)) {
                const body = requestBodyById.get(details.requestId);
                console.log(`get body[${details.requestId}]:`, body);
                requestBodyById.delete(details.requestId);
                fetch(details.url, {
                    method: details.method,
                    // TODO: sometimes the body is literally "[object Object]"
                    body,
                    headers: details.requestHeaders.reduce(
                        (acc, header) => ({
                            ...acc,
                            [header.name]: header.value,
                        }),
                        {},
                    ),
                })
                    .then((res) => {
                        if (res.status === 200) {
                            res.json().then((json) => {
                                console.log("Tweets:");
                                console.log(
                                    getTweets(
                                        json.data.home.home_timeline_urt
                                            .instructions,
                                    ),
                                );
                                // TODO: this either fetches the "For you" timeline or the "Home"
                                // timeline, depending on which one is loaded first. So we need to
                                // also fetch the other one by clicking on the "Home" or "For you"
                                // button.
                            });
                        } else {
                            console.error("Failed to fetch tweets");
                        }
                    })
                    .catch((err) => {
                        console.error(err);
                    });
            }
        },
        webRequestFilters,
        ["requestHeaders"],
    );

    // Wait for page to finish loading.
    await new Promise((resolve) => {
        chrome.tabs.onUpdated.addListener(function listener(
            tabId,
            changeInfo,
            tab,
        ) {
            if (tabId === tab.id && changeInfo.status === "complete") {
                chrome.tabs.onUpdated.removeListener(listener);
                resolve(undefined);
            }
        });
    });
}

refresh();
