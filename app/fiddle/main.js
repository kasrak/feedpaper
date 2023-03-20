const { app, BrowserWindow, BrowserView } = require("electron");

function createWindow() {
    const mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    const browserView = new BrowserView({
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
        },
    });

    mainWindow.setBrowserView(browserView);
    // TODO: need to resize the browserView when mainView gets resized
    // TODO: set the y based on window title bar height
    browserView.setBounds({ x: 0, y: 28, width: 1280, height: 800 });
    browserView.webContents.loadURL("https://twitter.com");

    // TODO: need to persist cookies so you don't get logged out
    browserView.webContents.session.webRequest.onBeforeRequest(
        { urls: ["*://twitter.com/*"] },
        (details, callback) => {
            if (details.resourceType === "xhr") {
                console.log("XHR request:", details.url);
            }
            callback({ cancel: false });
        },
    );
}

app.whenReady().then(createWindow);

app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
