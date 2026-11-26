import { app, BrowserWindow, session, shell } from "electron";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { createElectronWorkspaceHost } from "./electron-host";
const appRoot = app.getAppPath();
const demoMode = process.env.AMW_MODE === "demo";
const userBase = app.isPackaged
  ? join(app.getPath("appData"), "Agent Workspace")
  : appRoot;
const dataDir =
  process.env.AMW_DATA_DIR ??
  join(
    userBase,
    app.isPackaged
      ? demoMode
        ? "Demo"
        : "Workspace"
      : demoMode
        ? ".data-demo"
        : ".data",
  );
mkdirSync(dataDir, { recursive: true });
app.setPath("userData", join(dataDir, "electron"));
app.setName("Agent Workspace");
let win: BrowserWindow | null = null;
let host: ReturnType<typeof createElectronWorkspaceHost> | undefined;
/**
 * Automated tests run the app in the background (AMW_BACKGROUND=1): no window on screen, no Dock icon,
 * never the frontmost app, so a test run does not take the keyboard from whoever is typing. The page
 * still renders and runs its timers as if shown.
 */
const background = process.env.AMW_BACKGROUND === "1";
if (background && process.platform === "darwin")
  app.setActivationPolicy("accessory");

function createWindow(): void {
  win = new BrowserWindow({
    width: 1440,
    height: 920,
    ...(background ? { show: false, paintWhenInitiallyHidden: true } : {}),
    minWidth: 900,
    minHeight: 600,
    title: demoMode ? "Agent Workspace — Demo" : "Agent Workspace",
    backgroundColor: "#f4f5f7",
    // Native-looking frame: traffic lights sit inside the sidebar on macOS.
    ...(process.platform === "darwin"
      ? {
          titleBarStyle: "hiddenInset" as const,
          trafficLightPosition: { x: 16, y: 18 },
        }
      : {}),
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      // The mic opens at launch (meeting-style), before any click; without this
      // Chromium keeps the AudioContext suspended and the level stays at zero.
      autoplayPolicy: "no-user-gesture-required",
      // Chromium's built-in PDF viewer, for PDF previews (no PDF library bundled).
      plugins: true,
      // Hidden in the background mode, it must keep rendering and running timers as if on screen.
      ...(background ? { backgroundThrottling: false } : {}),
    },
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) void win.loadURL(devUrl);
  else void win.loadFile(join(appRoot, "out/renderer/index.html"));
  win.on("closed", () => (win = null));
}

app.whenReady().then(() => {
  if (!app.isPackaged && process.platform === "darwin")
    app.dock?.setIcon(join(appRoot, "build", "icon.png"));
  session.defaultSession.setPermissionRequestHandler(
    (wc, permission, callback, details) => {
      const media = details as { mediaTypes?: string[] };
      callback(
        ((permission === "media" &&
          (media.mediaTypes ?? []).every((t) => t === "audio")) ||
          permission === "clipboard-sanitized-write") &&
          wc === win?.webContents,
      );
    },
  );
  session.defaultSession.setPermissionCheckHandler(
    (_wc, permission) =>
      permission === "media" || permission === "clipboard-sanitized-write",
  );
  createWindow();
  host = createElectronWorkspaceHost({
    owner: win!,
    sender: () => win?.webContents,
    dataDir,
    appRoot,
    modelsDir:
      process.env.AMW_MODELS_DIR ??
      join(userBase, app.isPackaged ? "Models" : ".models"),
    demo: demoMode,
    memorySync: !demoMode || process.env.AMW_MEMORY_SYNC === "1",
  });
});
let quitting = false;
app.on("before-quit", (e) => {
  if (quitting) return;
  e.preventDefault();
  quitting = true;
  void host?.shutdown().finally(() => app.quit());
});
app.on("window-all-closed", () => app.quit());
