import * as path from "path";
import { format } from "url";
import { app, BrowserView, BrowserWindow } from "electron";
import { is } from "electron-util";
import terminate from "./terminate";
import { getFeedItemsFromResponse, shouldWatchRequest } from "./feedItems";

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

    browserView.webContents.loadURL("https://twitter.com");

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
                        getFeedItemsFromResponse(params, response);
                    }
                    break;
                }
            }
        },
    );
    browserView.webContents.debugger.sendCommand("Network.enable");
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
