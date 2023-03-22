import { getTweetsFromInstructions } from "../main/twitterUtils";

const fs = require("fs") as typeof import("fs");

const log = console.log.bind(console);

function main() {
    const homeTimeline = JSON.parse(
        // fs.readFileSync("./HomeTimeline.json", "utf8"),
        fs.readFileSync("./HomeLatestTimeline.json", "utf8"),
    );

    const tweets = getTweetsFromInstructions(
        homeTimeline.response.body.data.home.home_timeline_urt.instructions,
    );
    for (const tweet of tweets) {
        // TODO: remove follow up tweets from the same user (only include the first tweet)
        // TODO: include quoted/retweeted tweet text
        log("ID:", tweet.id);
        log(`@${tweet.user.screen_name}: ${tweet.full_text}`);
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
