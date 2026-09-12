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

/**
 * Checks for application updates and prompts the user with progress feedback.
 * Safe to call in both Web and Tauri environments.
 * @param {Function} onProgress Optional callback: ({ status, downloaded, total, percent }) => void
 */

export async function checkForUpdates(onProgress) {
  if (!isTauri()) {
    return;
  }

  try {
    const [{ check }, { relaunch }, { ask }] = await Promise.all([
          import('@tauri-apps/plugin-updater'),
          import('@tauri-apps/plugin-process'),
          import('@tauri-apps/plugin-dialog')
        ]);

    const update = await check();

    if (update) {
      // Prompt user in English
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
        let downloadedBytes = 0;
        let totalBytes = 0;

        // Download and install with progress tracking
        await update.downloadAndInstall((event) => {
          switch (event.event) {
            case 'Started':
              totalBytes = event.data.contentLength || 0;
              if (onProgress) {
                onProgress({ status: 'started', total: totalBytes, downloaded: 0, percent: 0 });
              }
              break;

            case 'Progress':
              downloadedBytes += event.data.chunkLength || 0;
              const percent = totalBytes > 0 ? Math.round((downloadedBytes / totalBytes) * 100) : 0;
              if (onProgress) {
                onProgress({
                  status: 'downloading',
                  total: totalBytes,
                  downloaded: downloadedBytes,
                  percent
                });
              }
              break;

            case 'Finished':
              if (onProgress) {
                onProgress({ status: 'finished', percent: 100 });
              }
              break;
          }
        });

        // Restart application to apply update
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
  // Check for update
  // DOM elements
  const updateModal = document.getElementById('update-modal');
  const progressText = document.getElementById('update-progress-text');
  const progressBar = document.getElementById('update-progress-bar');

  // Check for updates with dynamic UI progress callback
  checkForUpdates((progress) => {
    switch (progress.status) {
      case 'started':
        // Display modal when downloading begins
        updateModal.style.display = 'flex';
        progressText.innerText = 'Starting download...';
        progressBar.value = 0;
        break;

      case 'downloading':
        // Update progress bar and text status
        progressBar.value = progress.percent;
        
        const downloadedMB = (progress.downloaded / (1024 * 1024)).toFixed(1);
        const totalMB = (progress.total / (1024 * 1024)).toFixed(1);
        
        progressText.innerText = `Downloading: ${progress.percent}% (${downloadedMB} / ${totalMB} MB)`;
        break;

      case 'finished':
        // Final phase before automatic relaunch
        progressBar.value = 100;
        progressText.innerText = 'Installation complete. Restarting...';
        break;
    }
  });

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