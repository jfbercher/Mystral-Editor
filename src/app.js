import { loadConfig } from "./config.js";
import { initZoom, initExternalLinkHandler, isTauri } from "./utils/local_utils.js";
// import { listen } from "@tauri-apps/api/event";
// import { invoke } from "@tauri-apps/api/core";
//import { check } from '@tauri-apps/plugin-updater';
//import { relaunch } from '@tauri-apps/plugin-process';
//import { ask } from '@tauri-apps/plugin-dialog';
import { TabManager } from "./tab_manager.js";


/**
 * Checks for application updates and prompts the user if one is available.
 * Safe to call in both Web and Tauri environments.
 */
export async function checkForUpdates() {
  // Early return on standard Web environments to prevent loading Tauri plugins
  if (!isTauri()) {
    return;
  }

  try {
    // Dynamically import Tauri plugins in parallel only when inside the desktop runtime
    const [{ check }, { relaunch }, { ask }] = await Promise.all([
      import('@tauri-apps/plugin-updater'),
      import('@tauri-apps/plugin-process'),
      import('@tauri-apps/plugin-dialog')
    ]);

    // Check if a new version is available on GitHub Releases
    const update = await check();

    if (update) {
      // Prompt the user using the native OS dialog box
      const yes = await ask(
        `A new version (${update.version}) is available. Would you like to install it now?`,
        {
          title: 'Update Available',
          kind: 'info',
          okLabel: 'Update Now',
          cancelLabel: 'Later'
        }
      );

      if (yes) {
        // Download, install, and restart the application
        await update.downloadAndInstall();
        await relaunch();
      }
    }
  } catch (error) {
    console.error("Failed to check for application updates:", error);
  }
}


/**
 * Initializes the main application components and sets up Tauri listeners if running in Desktop mode.
 * 
 * @param {Object} options Configuration options for TabManager (roles, directives, transforms)
 * @returns {Promise<TabManager>} The initialized TabManager instance
 */
export async function initApp(options = {}) {
  // Load global configurations and initialize basic UI utilities
  await loadConfig();
  initZoom();
  initExternalLinkHandler();

  // Initialize the tab manager with passed custom roles and extensions
  const tabManager = new TabManager(options);
  await tabManager.init();

  // Handle desktop-specific interactions if running within Tauri
  if (isTauri()) {
    console.log("Tauri environment detected");
    // Dynamically import Tauri plugins in parallel only when inside the desktop runtime
    const [{ listen }, { invoke }] = await Promise.all([
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/core")
    ]);

    // Listen for file-open events emitted when the application is already running
    await listen("open-file", (event) => {
      console.log("File open event received:", event.payload);
      tabManager.openFileHandleInTab(event.payload);
    });
    console.log("Tauri 'open-file' listener successfully registered");

    // Check for any pending file passed during initial application startup (e.g., via macOS Finder)
    try {
      const pendingPath = await invoke("get_pending_file");
      if (pendingPath) {
        console.log("Retrieved pending startup file:", pendingPath);
        tabManager.openFileHandleInTab(pendingPath);
      }
    } catch (err) {
      console.error("Failed to retrieve pending startup file:", err);
    }
  }

  return tabManager;
}