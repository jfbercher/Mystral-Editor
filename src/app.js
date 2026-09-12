import { loadConfig } from "./config.js";
import { initZoom, initExternalLinkHandler, isTauri } from "./utils/local_utils.js";
import { TabManager } from "./tab_manager.js";
import { createUpdateUI } from "./utils/utils_ui.js";

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

        // Petite pause de sécurité de 1s pour laisser le temps au FS de libérer les verrous
        await new Promise((resolve) => setTimeout(resolve, 1000));

        // Redémarrage effectif
        await relaunch();
      }
    }
  } catch (error) {
    console.error("Failed to check for application updates:", error);
  }
}

export async function initApp(options = {}) {
  // Initialise l'UI de la modale d'update
  const updateUI = createUpdateUI();

  checkForUpdates((progress) => {
    switch (progress.status) {
      case 'started':
        updateUI.show();
        updateUI.update(0, 'Starting download...');
        break;

      case 'downloading':
        const downloadedMB = (progress.downloaded / (1024 * 1024)).toFixed(1);
        const totalMB = (progress.total / (1024 * 1024)).toFixed(1);
        const label = `Downloading: ${progress.percent}% (${downloadedMB} / ${totalMB} MB)`;
        
        updateUI.update(progress.percent, label);
        break;

      case 'finished':
        updateUI.update(100, 'Installation complete. Restarting...');
        break;
    }
  });

  await loadConfig();
  initZoom();
  initExternalLinkHandler();

  const tabManager = new TabManager(options);
  await tabManager.init();

 // Handle desktop-specific interactions if running within Tauri
  if (isTauri()) {
    console.log("Tauri environment detected");
    
    // Import Window API alongside Event and Core APIs
    const [{ listen }, { invoke }, { getCurrentWindow }] = await Promise.all([
      import("@tauri-apps/api/event"),
      import("@tauri-apps/api/core"),
      import("@tauri-apps/api/window")
    ]);

    // Force application window to the foreground on launch
    try {
      const appWindow = getCurrentWindow();
      await appWindow.show();
      await appWindow.setFocus();
    } catch (err) {
      console.error("Failed to focus window on startup:", err);
    }

    // Listen for file-open events
    await listen("open-file", (event) => {
      console.log("File open event received:", event.payload);
      tabManager.openFileHandleInTab(event.payload);
    });

    // Check for pending startup file
    try {
      const pendingPath = await invoke("get_pending_file");
      if (pendingPath) {
        tabManager.openFileHandleInTab(pendingPath);
      }
    } catch (err) {
      console.error("Failed to retrieve pending startup file:", err);
    }
  }

  return tabManager;
}