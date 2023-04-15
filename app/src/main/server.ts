const http = require("http");
const { run, all, jsonValue, datetimeValue } = require("./db");

const HOSTNAME = "0.0.0.0";
export const PORT = 2345;
export const SERVER_URL = `http://${HOSTNAME}:${PORT}`;

async function getBodyJson(req): Promise<any> {
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

function respondJson(res, statusCode, data) {
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "text/json");
    res.end(JSON.stringify(data, null, 2));
}

export async function startServer() {
    const server = http.createServer(async (req, res) => {
        // Allow CORS
        res.setHeader("Access-Control-Allow-Origin", "*");

        try {
            if (req.method === "POST") {
                const body = await getBodyJson(req);
                switch (body.cmd) {
                    case "saveTweets": {
                        const { tweets } = body.args;
                        for (const tweet of tweets) {
                            // TODO: batch this upsert
                            const result = await run(
                                "INSERT INTO items (tweet_id, content)" +
                                    " VALUES ($1, $2)" +
                                    " ON CONFLICT (tweet_id)" +
                                    " DO UPDATE SET content = $2",
                                [tweet.id, JSON.stringify(tweet)],
                            );
                        }
                        respondJson(res, 200, { ok: true });
                        break;
                    }
                    default:
                        respondJson(res, 400, { error: "Bad cmd" });
                }
            } else {
                function toItem(row) {
                    return {
                        ...row,
                        created_at: datetimeValue(row["created_at"]),
                        content: jsonValue(row["content"]),
                        enrichment: jsonValue(row["enrichment"]),
                    };
                }

                const url = new URL(req.url, SERVER_URL);
                switch (url.pathname) {
                    case "/getItems": {
                        const items = await all(
                            `SELECT * FROM items
                    WHERE created_at > $1 AND created_at < $2
                    AND content->'is_promoted' = 'false'
                    ORDER BY created_at, content->'id' ASC`,
                            [
                                url.searchParams.get("start"),
                                url.searchParams.get("end"),
                            ],
                            toItem,
                        );
                        respondJson(res, 200, { items: items });
                        break;
                    }
                    case "/getItem": {
                        const items = await all(
                            "SELECT * FROM items WHERE tweet_id = $1",
                            [url.searchParams.get("tweet_id")],
                            toItem,
                        );
                        respondJson(res, 200, { tweet: items[0] });
                        break;
                    }
                    default:
                        respondJson(res, 400, { error: "Bad path" });
                }
            }
        } catch (e) {
            respondJson(res, 500, { error: e.toString() });
        }
    });
    server.listen(PORT, HOSTNAME, () => {
        console.log(`Server running at ${SERVER_URL}`);
    });
}
