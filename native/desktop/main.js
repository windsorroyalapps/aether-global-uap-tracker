const { app, BrowserWindow, shell } = require("electron");
const fs = require("node:fs");
const path = require("node:path");

function resolveUrl() {
  if (process.env.AETHER_APP_URL) return process.env.AETHER_APP_URL;
  const candidates = [
    path.join(__dirname, "app-url.txt"),
    path.join(__dirname, "..", "app-url.txt"),
  ];
  for (const cfg of candidates) {
    try {
      const line = fs.readFileSync(cfg, "utf8").split("\n")[0].trim();
      if (line) return line;
    } catch {
      /* next */
    }
  }
  return "https://aether-global-uap-tracker.vercel.app";
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#09090b",
    title: "AETHER",
    icon: path.join(__dirname, "icon.png"),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadURL(resolveUrl());
}

app.whenReady().then(() => {
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
