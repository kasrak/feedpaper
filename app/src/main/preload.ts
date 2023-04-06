const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
    sendMessageToMain: (channel, message) => {
        ipcRenderer.send(channel, message);
    },
    on: (channel, callback) => {
        ipcRenderer.on(channel, (event, ...args) => callback(...args));
    },
    off: (channel, callback) => {
        ipcRenderer.off(channel, callback);
    },
});
