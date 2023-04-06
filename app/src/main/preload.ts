const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electron", {
    sendMessageToMain: (channel, message) => {
        ipcRenderer.send(channel, message);
    },
});
