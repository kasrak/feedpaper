const http = require("http");
const { client, query } = require("./db");

const hostname = "0.0.0.0";
const port = 8888;

async function getBodyJson(req) {
    return new Promise((resolve, reject) => {
        let body = "";
        req.on("data", (chunk) => {
            body += chunk.toString(); // convert Buffer to string
        });
        req.on("end", () => {
            resolve(JSON.parse(body));
        });
    });
}

async function getExistingTweetIds() {
    const result = await query("SELECT DISTINCT(tweet_id) FROM items");
    const existingTweetIds = new Set(result.rows.map((row) => row.tweet_id));
    return existingTweetIds;
}

function respondJson(res, statusCode, data) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "text/json");
    res.end(JSON.stringify(data, null, 2));
}

const server = http.createServer(async (req, res) => {
    if (req.method === "POST") {
        const body = await getBodyJson(req);
        switch (body.cmd) {
            case "saveTweets": {
                const existingTweetIds = await getExistingTweetIds();
                const { tweets } = body.args;
                for (const tweet of tweets) {
                    if (existingTweetIds.has(tweet.id)) {
                        continue;
                    }
                    // TODO: batch this insertion
                    await query(
                        "INSERT INTO items (tweet_id, created_at, content) VALUES ($1, $2, $3)",
                        [tweet.id, tweet.created_at, JSON.stringify(tweet)],
                    );
                }
                respondJson(res, 200, { ok: true });
                break;
            }
            default:
                respondJson(res, 400, { error: "Bad cmd" });
        }
    } else {
        res.statusCode = 200;
        res.setHeader("Content-Type", "text/plain");
        res.end("Hello World");
    }
});

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
});
