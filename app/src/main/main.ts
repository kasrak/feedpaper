import * as path from "path";
import { format } from "url";
import { app, BrowserView, BrowserWindow } from "electron";
import { is } from "electron-util";
import terminate from "./terminate";
import { saveFeedItemsFromResponse, shouldWatchRequest } from "./feedItems";

const http = require("http");
const { query } = require("./db");

process.on("unhandledRejection", (reason, promise) => {
    console.log("Unhandled Rejection at:", promise, "reason:", reason);
});

let mainWindow: BrowserWindow | null = null;

const windowSize = {
    width: 900,
    height: 780,
};
const topChromeHeight = 28;

async function createWindow() {
    mainWindow = new BrowserWindow({
        width: windowSize.width,
        height: windowSize.height,
        minHeight: 400,
        minWidth: 400,
        webPreferences: {
            nodeIntegration: true,
            preload: path.join(__dirname, "preload.js"),
        },
        show: false,
    });
    const isDev = is.development;
    if (isDev) {
        mainWindow.loadURL("http://localhost:9080");
    } else {
        mainWindow.loadURL(
            format({
                pathname: path.join(__dirname, "index.html"),
                protocol: "file",
                slashes: true,
            }),
        );
    }
    mainWindow.on("closed", () => {
        mainWindow = null;
    });
    mainWindow.on("ready-to-show", () => {
        mainWindow!.show();
        mainWindow!.focus();
    });

    const browserView = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            partition: "persist:main",
        },
    });
    mainWindow.setBrowserView(browserView);
    browserView.setBounds({
        x: 0,
        y: topChromeHeight,
        width: windowSize.width,
        height: windowSize.height - topChromeHeight,
    });
    mainWindow.on("resize", () => {
        if (mainWindow) {
            const [width, height] = mainWindow.getSize();
            browserView.setBounds({
                x: 0,
                y: topChromeHeight,
                width,
                height: height - topChromeHeight,
            });
        }
    });

    // browserView.webContents.openDevTools({ mode: "detach" });

    try {
        browserView.webContents.debugger.attach("1.3");
    } catch (err) {
        terminate(`Debugger attach failed: ${err}`);
    }
    browserView.webContents.debugger.on("detach", (event, reason) => {
        terminate(`Debugger detached: ${reason}`);
    });
    const pendingRequestIds = new Set<string>();
    browserView.webContents.debugger.on(
        "message",
        async (event, method, params) => {
            switch (method) {
                case "Network.responseReceived": {
                    // params: {requestId, type, response}
                    if (shouldWatchRequest(params)) {
                        pendingRequestIds.add(params.requestId);
                    }
                    break;
                }
                case "Network.loadingFinished": {
                    // params: {requestId}
                    if (pendingRequestIds.has(params.requestId)) {
                        pendingRequestIds.delete(params.requestId);

                        const response =
                            await browserView.webContents.debugger.sendCommand(
                                "Network.getResponseBody",
                                {
                                    requestId: params.requestId,
                                },
                            );
                        saveFeedItemsFromResponse(response, serverUrl);
                    }
                    break;
                }
            }
        },
    );
    browserView.webContents.debugger.sendCommand("Network.enable");

    while (true) {
        browserView.webContents.loadURL("https://twitter.com");
        // Wait for it to finish loading.
        await new Promise((resolve) => {
            browserView.webContents.on("did-finish-load", resolve);
        });
        await browserView.webContents.executeJavaScript(`
    (async function() {
        let btns = [];
        while (true) {
            btns = Array.from(document.querySelectorAll("a")).filter(
                node => {
                    return node.innerText.toLowerCase().includes("following") || node.innerText.toLowerCase().includes("for you");
                }
            );
            if (btns.length > 0) {
                break;
            } else {
                console.log("Waiting for buttons to appear...");
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
        console.log("buttons", btns);
        for (const btn of btns) {
            console.log("Clicking", btn.innerText);
            btn.click();
            await new Promise(resolve => setTimeout(resolve, 5000 + Math.random() * 2000));
        }
    })();
    `);
        // Run every 30mins.
        await new Promise((resolve) => setTimeout(resolve, 1000 * 60 * 30));
    }
}

app.on("ready", createWindow);

app.on("window-all-closed", () => {
    if (!is.macos) {
        app.quit();
    }
});

app.on("activate", () => {
    if (mainWindow === null && app.isReady()) {
        createWindow();
    }
});

const hostname = "0.0.0.0";
const port = 2345;
const serverUrl = `http://${hostname}:${port}`;

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

const server = http.createServer(async (req, res) => {
    // Allow CORS
    res.setHeader("Access-Control-Allow-Origin", "*");

    if (req.method === "POST") {
        const body = await getBodyJson(req);
        switch (body.cmd) {
            case "saveTweets": {
                const { tweets } = body.args;
                for (const tweet of tweets) {
                    // TODO: batch this upsert
                    await query(
                        "INSERT INTO items (tweet_id, created_at, content)" +
                            " VALUES ($1, $2, $3)" +
                            " ON CONFLICT (tweet_id)" +
                            " DO UPDATE SET content = $3",
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
        const url = new URL(req.url, serverUrl);
        switch (url.pathname) {
            case "/getItems": {
                const items = await query(
                    `SELECT * FROM items
                    WHERE created_at > $1 AND created_at < $2
                    AND content->'is_promoted' = 'false'
                    ORDER BY created_at, id ASC`,
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
    console.log(`Server running at ${serverUrl}`);
});
