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
    // Allow CORS
    res.setHeader("Access-Control-Allow-Origin", "*");

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
        const url = new URL(req.url, "http://localhost:8888");
        switch (url.pathname) {
            case "/getItems": {
                const items = await query(
                    "SELECT * FROM items WHERE created_at > $1 AND created_at < $2 ORDER BY created_at DESC",
                    [
                        url.searchParams.get("start"),
                        url.searchParams.get("end"),
                    ],
                );
                respondJson(res, 200, { items: items.rows });
                break;
            }
            case "/getItem": {
                const items = await query(
                    "SELECT * FROM items WHERE tweet_id = $1",
                    [url.searchParams.get("tweet_id")],
                );
                respondJson(res, 200, { tweet: items.rows[0] });
                break;
            }
            default:
                respondJson(res, 400, { error: "Bad path" });
        }
    }
});

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
});
