import * as path from "path";
import { format } from "url";
import { app, BrowserView, BrowserWindow, shell, ipcMain } from "electron";
import { is } from "electron-util";
import terminate from "./terminate";
import { saveFeedItemsFromResponse, shouldWatchRequest } from "./feedItems";
import { BACKEND_BASE_URL, FRONTEND_BASE_URL, startServer } from "./server";

process.on("unhandledRejection", (reason, promise) => {
    console.log("Unhandled Rejection at:", promise, "reason:", reason);
});

let mainWindow: BrowserWindow | null = null;

const windowSize = {
    width: 900,
    height: 780,
};
const topChromeHeight = 28 + 48;

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

    const clientBrowserView = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            partition: "persist:main",
        },
    });
    clientBrowserView.setBackgroundColor("#fff");
    clientBrowserView.setBounds({
        x: 0,
        y: topChromeHeight,
        width: windowSize.width,
        height: windowSize.height - topChromeHeight,
    });
    mainWindow.addBrowserView(clientBrowserView);

    const twitterBrowserView = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            partition: "persist:main",
        },
    });
    mainWindow.addBrowserView(twitterBrowserView);
    twitterBrowserView.setBounds({
        x: 0,
        y: topChromeHeight,
        width: windowSize.width,
        height: windowSize.height - topChromeHeight,
    });
    clientBrowserView.setBounds({
        x: 0,
        y: topChromeHeight,
        width: windowSize.width,
        height: windowSize.height - topChromeHeight,
    });
    mainWindow.on("resize", () => {
        if (mainWindow) {
            const [width, height] = mainWindow.getSize();
            twitterBrowserView.setBounds({
                x: 0,
                y: topChromeHeight,
                width,
                height: height - topChromeHeight,
            });
            clientBrowserView.setBounds({
                x: 0,
                y: topChromeHeight,
                width,
                height: height - topChromeHeight,
            });
        }
    });

    twitterBrowserView.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("https://") || url.startsWith("http://")) {
            shell.openExternal(url);
        }
        return { action: "deny" };
    });
    clientBrowserView.webContents.setWindowOpenHandler(({ url }) => {
        if (url.startsWith("https://") || url.startsWith("http://")) {
            shell.openExternal(url);
        }
        return { action: "deny" };
    });

    try {
        twitterBrowserView.webContents.debugger.attach("1.3");
    } catch (err) {
        terminate(`Debugger attach failed: ${err}`);
    }
    twitterBrowserView.webContents.debugger.on("detach", (event, reason) => {
        terminate(`Debugger detached: ${reason}`);
    });
    const pendingRequestIds = new Set<string>();
    twitterBrowserView.webContents.debugger.on(
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
                            await twitterBrowserView.webContents.debugger.sendCommand(
                                "Network.getResponseBody",
                                {
                                    requestId: params.requestId,
                                },
                            );
                        saveFeedItemsFromResponse(response, BACKEND_BASE_URL);
                    }
                    break;
                }
            }
        },
    );
    twitterBrowserView.webContents.debugger.sendCommand("Network.enable");

    clientBrowserView.webContents.loadURL(FRONTEND_BASE_URL);

    mainWindow.setTopBrowserView(clientBrowserView);
    mainWindow.webContents.send("selected-tab-changed", { tab: "feedpaper" });
    const setTab = (event, arg) => {
        switch (arg.tab) {
            case "twitter":
                mainWindow.setTopBrowserView(twitterBrowserView);
                break;
            case "feedpaper":
                mainWindow.setTopBrowserView(clientBrowserView);
                break;
            default:
                terminate(`Unknown tab: ${arg.tab}`);
        }
        mainWindow.webContents.send("selected-tab-changed", arg);
    };
    const openInBrowser = () => {
        shell.openExternal(FRONTEND_BASE_URL);
    };
    ipcMain.on("set-tab", setTab);
    ipcMain.on("open-in-browser", openInBrowser);
    mainWindow.on("close", () => {
        ipcMain.off("set-tab", setTab);
        ipcMain.off("open-in-browser", openInBrowser);
    });

    while (true) {
        twitterBrowserView.webContents.loadURL("https://twitter.com");
        // Wait for it to finish loading.
        await new Promise((resolve) => {
            twitterBrowserView.webContents.on("did-finish-load", resolve);
        });
        await twitterBrowserView.webContents.executeJavaScript(`
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

startServer();

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
