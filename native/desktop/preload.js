const { contextBridge } = require("electron");

contextBridge.exposeInMainWorld("aetherNative", {
  platform: "desktop",
});
