// Gère l'état et la manipulation d'un onglet ou d'un fichier ouvert.
import { get, set, del } from "idb-keyval";
import { applyThemeAtStartup, applyCodeMirrorTheme } from './theme.js';
import { showStatsPopup } from './stats.js';
import { config } from "../../config.js";
import { showToast } from '../utils_ui.js';
import { saveCommentsForPath, loadCommentsForPath } from "../commentsStorage.js";
import { effect, signal } from '@preact/signals';


import { 
  workingDirectory, 
  currentFileDir,
  selectWorkingFolder,
  hasFileSystemAccess,
  isFallbackHandle,
  pickFileWithInput,
  getRecentFileHandles, 
  addRecentFileHandle, 
  saveFileToPathParam, 
  loadFileFromPathParam, 
  saveBackupFile
} from './fs.js';
import { loadSidecar, applySidecarOutputs, scheduleNamespaceRestore, saveSidecarWithNamespace, saveSidecarToFile } from "./sidecar.js";


let timing_debug = false;

// Détection de l'environnement Tauri
const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

let tauriDialog, tauriFs;

if (isTauri) {
  Promise.all([
    import('@tauri-apps/plugin-dialog'),
    import('@tauri-apps/plugin-fs')
  ]).then(([dialog, fs]) => {
    tauriDialog = dialog;
    tauriFs = fs;
  });
}

// Fonction utilitaire pour extraire le nom de fichier d'un chemin (Tauri) ou Handle (Web)
function getFileName(fileHandleOrPath) {
  if (!fileHandleOrPath) return config.defaultFileName;
  if (typeof fileHandleOrPath === 'string') {
    return fileHandleOrPath.split('/').pop().split('\\').pop();
  }
  return fileHandleOrPath.name || config.defaultFileName;
}

// Fonction utilitaire pour construire une clé de sauvegarde
// chemin complet (Tauri) ou workingDir+Handle (Web)
function getFileKey(fileHandleOrPath) {
  if (!fileHandleOrPath) return config.defaultFileName;
  if (typeof fileHandleOrPath === 'string') {
    return fileHandleOrPath;
  }
  // workingDirectory stays null until the user grants a folder, which on the web
  // is the normal state before the first showDirectoryPicker.  Reading `.name`
  // on it threw a TypeError that loadFileFromHandle's catch turned into a silent
  // "file loaded empty", so the document came up as the blank template.
  const fileName = fileHandleOrPath.name || config.defaultFileName;
  const dirName = workingDirectory.value?.name;
  // Note the parentheses: `a + '_' + b || c` parses as `(a + '_' + b) || c`, so
  // the previous fallback was unreachable and a nameless handle yielded
  // "<dir>_undefined".
  return dirName ? `${dirName}_${fileName}` : fileName;
}

// Persist the active tab ID
export async function saveActiveTabId(tabId) {
  return await set("activeTabId", tabId);
}

// Retrieve the stored active tab ID
export async function getActiveTabId() { 
  return await get("activeTabId");
}


export function createTabState(editorId, onFileChanged, onDirtyChanged) {
  let activeWorkingDir = workingDirectory.value;

  const tab = {
    editorId,
    currentFileHandle: null,
    selectedFileHandle: null,
    currentFileName: config.defaultFileName,
    currentFilePathParam: null,
    autoSaveEnabled: config.autoSaveEnabled, //true,
    editorReady: false,
    dirty: false,
    // True only once this tab has actually read its file (or created it through
    // "Save as"). A handle restored from storage is a claim, not a proof: until
    // it is verified, nothing may be written to it -- see saveCurrentDoc.
    fileLoaded: false,
    lastLoadError: null,
    lastSavedText: "",
    ycommentsRef: null,
    pendingCommentsState: null,
  };
  
  tab.subtitleText = signal("");

  // Comments ------

  function tryApplyComments() {
    if (tab.pendingCommentsState && tab.ycommentsRef) {
      tab.ycommentsRef.applyState(tab.pendingCommentsState);
      tab.pendingCommentsState = null;
    }
  }

  /** À appeler dès que collab.value.ycomments existe (depuis onReady/effect côté index.html). */
  tab.registerYComments = (ycomments) => {
    tab.ycommentsRef = ycomments;
    tryApplyComments();
  };

  /** À appeler dès que le chemin du fichier + son contenu texte sont connus (chargement du fichier). */
  tab.loadCommentsForCurrentFile = async () => {
    const fileKey = tab.currentFileKey; //tab.currentFileName; 
    if (!fileKey) return;
    tab.pendingCommentsState = await loadCommentsForPath(fileKey);
    tryApplyComments();
  };

  tab.saveCommentsForCurrentFile = async () => {
    const fileKey = tab.currentFileKey; //tab.currentFileName;
    if (!fileKey || !tab.ycommentsRef) return;
    await saveCommentsForPath(fileKey, tab.ycommentsRef);
  };

  // End comments ------

    tab.setDirty = (value) => {
      if (tab.dirty === value) return;
      tab.dirty = value;
      onDirtyChanged?.(value);
    };

  tab.markSaved = (text) => {
    tab.lastSavedText = text;
    tab.setDirty(false);
  };

  tab.checkDirty = (currentText) => { tab.setDirty(currentText !== tab.lastSavedText); };
  tab.setEditorReady = (value) => { tab.editorReady = value; };
  tab.setCurrentFilePathParam = (value) => { tab.currentFilePathParam = value; };
  tab.toggleAutoSave = () => { tab.autoSaveEnabled = !tab.autoSaveEnabled; return tab.autoSaveEnabled; };

  tab.setEditorTextBefore = (newText) => {
    if (timing_debug) {const tE = performance.now();}
    const view = window.myst_editor[editorId]?.main_editor;
    if (!view) {
      console.warn("Editor not ready yet:", editorId);
      return;
    }
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: newText }, selection: { anchor: 0 } });
    view.focus();
    if (timing_debug) console.log("setEditorText:", (performance.now() - tE).toFixed(0));
  };

  tab.setEditorText = (newText) => {
  const view = window.myst_editor[editorId]?.main_editor;
  if (!view) return;
  if (view.state.doc.length === newText.length && view.state.doc.toString() === newText) {
    view.focus();
    return;
  }
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: newText }, selection: { anchor: 0 } });
  view.focus();
};

  tab.setSubtitleOld = async (text) => {
    const shadowRoot = document.getElementById(editorId)?.shadowRoot;
    const subtitle = shadowRoot?.getElementById("document-subtitle");
    let currentDir = workingDirectory.value || (isTauri ? localStorage.getItem("workingDirHandle") : await get("workingDirHandle"));
    if (subtitle) {
      let dirName = "Undefined";
      if (currentDir) {
        dirName = typeof currentDir === 'string' ? currentDir.split('/').pop() : currentDir.name;
      }
      subtitle.innerHTML = "Editing " + text + "  &emsp; - &emsp;   Working dir: " + dirName;
    }
  };

  tab.setSubtitleBefore = (text) => {
    effect(async () => {
      const shadowRoot = document.getElementById(editorId)?.shadowRoot;
      const subtitle = shadowRoot?.getElementById("document-subtitle");
      
       // const currentDir = workingDirectory.value
       // || (isTauri() ? localStorage.getItem("workingDirHandle") : await get("workingDirHandle"));

      const currentDir = isTauri
        ? currentFileDir.value
        : workingDirectory.value || "";

      if (subtitle) {
        let dirName = "Undefined";
        if (currentDir) {
          dirName = typeof currentDir === 'string' ? currentDir.split('/').pop() : currentDir.name;
        }
        subtitle.innerHTML = "Editing " + text + "  &emsp; - &emsp;   Working dir: " + dirName;
      }
    });
  };

  tab.setSubtitle = (text) => {
    tab.subtitleText.value = text;
  };

  tab.setCurrentFile = async (handleOrPath) => {
    if (handleOrPath === null) {
      tab.currentFileHandle = null;
      tab.selectedFileHandle = null;
      tab.currentFileKey = null;
      tab.currentFileName = null;
      tab.fileLoaded = false;
      currentFileDir.value = null;
      await tab.setSubtitle("");
      onFileChanged?.();
      return;
    }
    tab.currentFileHandle = handleOrPath;
    tab.currentFileName = getFileName(handleOrPath);
    tab.currentFileKey = getFileKey(handleOrPath);
    // Reached from "Save as" and from an explicit open: the file exists and is
    // ours in both cases.
    tab.fileLoaded = true;
    tab.lastLoadError = null;
    await tab.setSubtitle(tab.currentFileName);
    
    if (isTauri) {
      currentFileDir.value = typeof handleOrPath === 'string' 
      ? handleOrPath.split('/').slice(0, -1).join('/')
      : null;
      localStorage.setItem(`storedFileHandle:${editorId}`, tab.currentFileHandle);
    } else {
      await set(`storedFileHandle:${editorId}`, tab.currentFileHandle);
    }
    onFileChanged?.();
  };

  tab.delKeyFromDB = async () => {
    if (isTauri) {
      localStorage.removeItem(`storedFileHandle:${editorId}`);
    } else {
      await del(`storedFileHandle:${editorId}`);
    }
  };

  tab.selectMarkdownFile = async () => {
    console.log("Opening new file...");
    if (isTauri) {
      //if (!tauriDialog) tauriDialog = await import('@tauri-apps/plugin-dialog');
      while (!tauriDialog) await new Promise(r => setTimeout(r, 50));
      const selected = await tauriDialog.open({
          multiple: false,
          filters: [{ description: "Markdown Files", name: "Markdown", extensions: ["md", "markdown", "txt", "yml", "yaml"] }]
        });
      if (selected) {
        localStorage.setItem(`storedFileHandle:${editorId}`, selected);
        return selected;
      }
      return null;
    } else {
      if (!hasFileSystemAccess()) {
        // Safari and Firefox have no showOpenFilePicker: open through a plain
        // <input type="file">.  The resulting handle cannot be written back to
        // nor persisted, which the save path and the guards below account for.
        const fallback = await pickFileWithInput();
        if (fallback) {
          showToast(
            "Opened read-only: this browser cannot write back to the file. Use Save as to download your changes.",
            "success",
            6000
          );
        }
        return fallback;
      }
      const [fileHandle] = await window.showOpenFilePicker({
        types: [{ description: "Markdown Files", accept: { "text/markdown": [".md", ".markdown", ".txt"] } }],
        multiple: false,
      });
      await set(`storedFileHandle:${editorId}`, fileHandle);
      return fileHandle;
    }
  };

  tab.loadFileFromHandle = async (fileHandleOrPath) => {
    try {
      if (isTauri) {
        // fileHandleOrPath est une chaîne de caractères (chemin d'accès absolu)
        const textContent = await tauriFs.readTextFile(fileHandleOrPath);
        tab.fileLoaded = true;
        tab.lastLoadError = null;
        tab.currentFileHandle = fileHandleOrPath;
        tab.selectedFileHandle = fileHandleOrPath;
        tab.currentFileName = getFileName(fileHandleOrPath);
        tab.currentFileKey =  getFileKey(fileHandleOrPath);
        currentFileDir.value = typeof fileHandleOrPath === 'string'  
          ? fileHandleOrPath.split('/').slice(0, -1).join('/')
          : null;
        localStorage.setItem(`storedFileHandle:${editorId}`, tab.currentFileHandle);
        await tab.setSubtitle(tab.currentFileName);
        onFileChanged?.();
        // Simule l'objet File pour conserver la compatibilité de retour (.text())
        // Load sidecar synchronously before returning so the next render finds
        // restoredOutputCache already populated (no race with markdown render).
        const _sidecar = await loadSidecar(fileHandleOrPath);
        if (_sidecar) {
          applySidecarOutputs(_sidecar);       // sync – populates restoredOutputCache
          scheduleNamespaceRestore(_sidecar);  // async fire-and-forget
        }
        return { text: async () => textContent };
      } else {
        const options = { mode: "readwrite" };
        let permission = await fileHandleOrPath.queryPermission(options);
        if (permission !== "granted") permission = await fileHandleOrPath.requestPermission(options);
        if (permission !== "granted") {
          console.warn("Permission denied for file:", fileHandleOrPath.name);
          tab.lastLoadError = { reason: "permission", name: fileHandleOrPath.name };
          return null;
        }
        const fileData = await fileHandleOrPath.getFile();
        tab.fileLoaded = true;
        tab.lastLoadError = null;
        tab.currentFileHandle = fileHandleOrPath;
        tab.selectedFileHandle = fileHandleOrPath;
        tab.currentFileName = fileHandleOrPath.name;
        tab.currentFileKey =  getFileKey(fileHandleOrPath);
        // A fallback handle is not structured-cloneable and is only a snapshot.
        if (!isFallbackHandle(tab.currentFileHandle)) {
          await set(`storedFileHandle:${editorId}`, tab.currentFileHandle);
        }
        await tab.setSubtitle(tab.currentFileName);
        onFileChanged?.();
        // Load sidecar (web: IndexedDB) before return so restoredOutputCache is
        // populated before the markdown renders.
        const _sidecar = await loadSidecar(tab.currentFileKey);
        if (_sidecar) {
          applySidecarOutputs(_sidecar);
          scheduleNamespaceRestore(_sidecar);
        }
        // On the web a FileSystemFileHandle carries no access to its parent
        // directory -- the File System Access API deliberately withholds it.  So
        // relative paths stay unresolvable until a working folder is granted
        // separately: images do not display, and Python cells cannot open the
        // data files sitting next to the document.  Tauri has no such limit, it
        // derives currentFileDir from the path above.
        if (!workingDirectory.value) {
          showToast(
            "No working folder selected: images and local files used by this document cannot be read.",
            "error",
            0,
            { label: "Choose folder", onClick: () => selectWorkingFolder() }
          );
        }
        return fileData;
      }
    } catch (error) {
      console.error("Failed to load file:", error);
      tab.lastLoadError = {
        reason: error && (error.name === "NotFoundError" || error.name === "NotAllowedError")
          ? (error.name === "NotFoundError" ? "missing" : "permission")
          : "error",
        name: typeof fileHandleOrPath === "string" ? getFileName(fileHandleOrPath) : fileHandleOrPath?.name,
        error,
      };
      return null;
    }
  };

  /**
   * Break the link between this tab and a file we could not read. Without this,
   * a tab keeps a handle it never verified and the next autosave happily writes
   * the document over it -- recreating a deleted file, or clobbering one that
   * was merely unreadable for a moment. After detaching, any save becomes a
   * "Save as", which is the same route a brand-new tab takes.
   */
  tab.detachFileHandle = async ({ notify = true } = {}) => {
    const lostName = tab.currentFileName;
    const reason = tab.lastLoadError?.reason;
    await tab.setCurrentFile(null);
    if (isTauri) localStorage.removeItem(`storedFileHandle:${editorId}`);
    else await set(`storedFileHandle:${editorId}`, null);
    tab.currentFileName = config.defaultFileName;
    if (notify) {
      showToast(
        reason === "permission"
          ? `Could not reopen "${lostName}": access was not granted. This tab is no longer linked to that file; saving will ask where to write.`
          : `Could not reopen "${lostName}": the file is missing or unreadable. This tab is no longer linked to that file; saving will ask where to write.`,
        "error",
        0,
      );
    }
    return lostName;
  };

  tab.openNewFile = async () => {
    console.log("Opening new file...");
    try {
      const fileHandleOrPath = await tab.selectMarkdownFile();
      // console.log("Opening new file... (n)");
      if (!fileHandleOrPath) return;
      const file = await tab.loadFileFromHandle(fileHandleOrPath);
      if (file) {
        await addRecentFileHandle(fileHandleOrPath);
        await tab.setCurrentFile(fileHandleOrPath);
        const content = await file.text();
        tab.setEditorText(content);
        tab.markSaved(content);
        tab.setDirty(false);
        console.log(`Opened file: ${tab.currentFileName}`, tab);
      }
    } catch (err) {
      if (err.name !== "AbortError") console.error("Open file error:", err);
    }
  };

  tab.loadFileOnStartup = async () => {
    const stored = isTauri 
      ? localStorage.getItem(`storedFileHandle:${editorId}`) 
      : await get(`storedFileHandle:${editorId}`);
    if (!stored) return null;
    const fileData = await tab.loadFileFromHandle(stored);
    if (!fileData) await tab.detachFileHandle();
    return fileData;
  };

  tab.getRecentFileOptions = async (maxFiles = config.recentFilesMax, onOpenHandle = null) => {
    const handles = await getRecentFileHandles();
    return handles.slice(0, maxFiles).map((handleOrPath) => {
      const fileName = getFileName(handleOrPath);
      return {
        id: fileName,
        text: fileName,
        action: async () => {
          if (onOpenHandle) {
            await onOpenHandle(handleOrPath);
          } else {
            const file = await tab.loadFileFromHandle(handleOrPath);
            if (file) {
              const text = await file.text();
              tab.setEditorText(text);
              tab.markSaved(text); 
              tab.currentFileName = fileName;
            }
          }
        },
      };
    });
  };

  tab.saveCurrentDoc = async ({ skipSidecar = false } = {}) => {
    const contentToSave = window.myst_editor[editorId].text;

    // Never write through a handle we never managed to read: the editor would
    // then be holding the new-file template, not that document's content.
    if (!tab.currentFilePathParam && tab.currentFileHandle && !tab.fileLoaded) {
      console.warn("Refusing to save to an unverified file handle:", tab.currentFileName);
      return await tab.saveAs();
    }

    if (tab.currentFilePathParam) {
      await saveFileToPathParam(tab.currentFilePathParam, contentToSave);
      tab.markSaved(contentToSave);
      await tab.saveCommentsForCurrentFile(); 
      console.log(`Saved (via path param): ${tab.currentFilePathParam}`);
    } else if (isTauri) {
      await tauriFs.writeTextFile(tab.currentFileHandle, contentToSave);
      tab.markSaved(contentToSave);
      await tab.saveCommentsForCurrentFile();
      if (!skipSidecar) saveSidecarWithNamespace(tab.currentFileHandle).catch(e => console.warn('[sidecar] save failed:', e));
      showToast(`Save: ${tab.currentFileName} successful.`);
      console.log(`Saved (Tauri): ${tab.currentFileName}`);
    } else if (isFallbackHandle(tab.currentFileHandle)) {
      // <input type="file"> grants no write-back permission, so the only way to
      // keep the changes is to download a copy.
      return await tab.saveAs();
    } else {
      const writable = await tab.currentFileHandle.createWritable();
      await writable.write(contentToSave);
      await writable.close();
      tab.markSaved(contentToSave);
      await tab.saveCommentsForCurrentFile(); 
      if (!skipSidecar) saveSidecarWithNamespace(tab.currentFileKey).catch(e => console.warn('[sidecar] save failed:', e));
      showToast(`Save: ${tab.currentFileName} successful.`);
      console.log(`Saved: ${tab.currentFileName}`);
    }
    return true;
  };

  tab.saveSidecarToFile = async () => {
    await saveSidecarToFile(tab.currentFileHandle, tab.currentFileName);
    showToast(`Save: ${tab.currentFileName} with sidecar successful.`);
  };

  tab.autosave = async () => {
    if (!tab.currentFilePathParam && !tab.currentFileHandle) return;
    if (!tab.autoSaveEnabled) return;

    try {
      const content = window.myst_editor[editorId].text;

      if (!content.trim()) {
        if (tab.currentFilePathParam) {
          const pathResult = await loadFileFromPathParam();
          if (pathResult) tab.currentFilePathParam = pathResult.path;
          return;
        } else {
          const file = await tab.loadFileFromHandle(tab.currentFileHandle);
          if (file) {
            const fileContent = await file.text();
            tab.setEditorText(fileContent);
            tab.markSaved(fileContent); 
            console.log(`Content empty, reloading ${tab.currentFileName}`);
          }
          return;
        }
      }
      if (tab.dirty) {
        await tab.saveCurrentDoc({ skipSidecar: true });
        // Web: IDB sidecar save is cheap — piggyback on autosave
        if (!isTauri) {
          saveSidecarWithNamespace(tab.currentFileKey)
            .catch(e => console.warn('[sidecar] autosave IDB failed:', e));
        }
        console.log(`Autosave: ${tab.currentFileName}`);
      }
      else {
        // console.log(`Not autosaved (not changed): ${tab.currentFileName}`);
      }
      await tab.saveCommentsForCurrentFile(); 
      // console.log(`Autosave : ${tab.currentFileName}`);
    } catch (err) {
      console.error("Autosave error:", err);
    }
  };

  tab.saveAs = async () => {
    const content = window.myst_editor[editorId].text;

    // 1. Sauvegarde native Tauri
    if (isTauri) {
      try {
        const filePath = await tauriDialog.save({
          defaultPath: tab.currentFileName || "document.md",
          filters: [{ name: "Markdown", extensions: ["md", "markdown", "txt"] }]
        });
        if (filePath) {
          await tauriFs.writeTextFile(filePath, content);
          await tab.setCurrentFile(filePath);
          await addRecentFileHandle(filePath);
          tab.markSaved(content);
          await tab.saveCommentsForCurrentFile();
          saveSidecarWithNamespace(filePath).catch(e => console.warn('[sidecar] saveAs failed:', e));
          showToast(`Save-as successful.`);
          return true;
        }
        return false;
      } catch (err) {
        console.error("Tauri save as error:", err);
        return false;
      }
    }

    // 2. showSaveFilePicker (Chrome, Edge, Opera)
    if ("showSaveFilePicker" in window) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: tab.currentFileName || "document.md",
          types: [{ description: "Markdown Files", accept: { "text/markdown": [".md", ".markdown"] } }],
        });
        await tab.setCurrentFile(handle);
        await addRecentFileHandle(handle);
        await tab.saveCurrentDoc();
        return true;
      } catch (err) {
        if (err.name !== "AbortError") console.error("Save as error:", err);
        return false;
      }
    }

    // 3. Fallback Web basique (Firefox, Safari Web)
    const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = tab.currentFileName || "document.md";
    a.click();
    URL.revokeObjectURL(a.href);
    return true;
  };

  tab.handleBackup = async () => {
    const currentContent = window.myst_editor[editorId]?.text ?? "";
    const currentHandle = tab.currentFileHandle;
    if (!currentContent.trim()) {
        return false;
    }

    const success = await saveBackupFile(currentHandle, currentContent);
    if (success) {
      showToast(`Backup of ${tab.currentFileName} successful.`);
      console.log("Backup with success.");
    }
  };

  tab.smartSave = async () => {
    // A fallback handle looks like a file we own but cannot be written to, so it
    // has to take the same route as "no handle at all": download a copy.
    if (!isFallbackHandle(tab.currentFileHandle)
        && (tab.currentFileHandle || tab.currentFilePathParam)) {
      return await tab.saveCurrentDoc();
    }
    return await tab.saveAs();
  };

  tab.applyThemeAtStartup = () => applyThemeAtStartup(editorId);
  tab.applyCodeMirrorTheme = () => applyCodeMirrorTheme(editorId);
  tab.showStatsPopup = () => showStatsPopup(editorId);

  return tab;
}