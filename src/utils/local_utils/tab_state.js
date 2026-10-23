// Gère l'état et la manipulation d'un onglet ou d'un fichier ouvert.
import { get, set, del } from "idb-keyval";
import { refreshPyodideOutputs } from "./pyodideExport.js";
import { siteRunning } from "./mystExport.js";
import { applyThemeAtStartup, applyCodeMirrorTheme } from './theme.js';
import { showStatsPopup } from './stats.js';
import { config } from "../../config.js";
import { showToast } from '../utils_ui.js';
import { saveCommentsForPath, loadCommentsForPath } from "../commentsStorage.js";
import { effect, signal } from '@preact/signals';


import { 
  workingDirectory, 
  currentFileDir,
  setEditorFileKey,
  clearEditorPythonSpace,
  selectWorkingFolder,
  hasFileSystemAccess,
  isFallbackHandle,
  pickFileWithInput,
  fileName as baseNameOf,
  parentDir as dirNameOf,
  getRecentFileHandles, 
  addRecentFileHandle, 
  saveFileToPathParam, 
  loadFileFromPathParam, 
  saveBackupFile
} from './fs.js';
import { loadSidecar, applySidecarOutputs, scheduleNamespaceRestore, saveSidecarWithNamespace, saveSidecarToFile } from "./sidecar.js";
import { convertNotebookToMyst, convertMystToNotebook } from "../ipynb2mystLib.js";
import { foldFrontmatter, shouldFoldFrontmatter } from "../../extensions/frontmatterFold.js";


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
    return baseNameOf(fileHandleOrPath);
  }
  return fileHandleOrPath.name || config.defaultFileName;
}

// A Jupyter notebook opened in the editor is converted to MyST Markdown on the
// fly.  The tab is then mounted on the sibling .md path (Tauri) or left without
// a write target (web, where a FileSystemFileHandle cannot be renamed).  The
// .ipynb itself is never written to except through an explicit "Save as", and
// that export carries code and text only -- not outputs, not kernel metadata.
function isNotebookFile(fileHandleOrPath) {
  const name = typeof fileHandleOrPath === "string"
    ? fileHandleOrPath
    : (fileHandleOrPath?.name ?? "");
  return /\.ipynb$/i.test(name);
}

function toMarkdownName(name) {
  return name.replace(/\.ipynb$/i, ".md");
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
    // Modification time of the file as the editor last saw it: set when the
    // file is read, and again after every write. `null` means "not known", and
    // nothing is checked -- a new document, a notebook mounted on a .md that
    // does not exist yet, a handle a restart restored but never read.
    knownMtime: null,
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
    // Same text, but still a document being loaded: a restored tab is created
    // with its content already in place.
    if (shouldFoldFrontmatter()) foldFrontmatter(view);
    view.focus();
    return;
  }
  view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: newText }, selection: { anchor: 0 } });
  // A document is opened on its text, not on its metadata. Done here rather
  // than in an extension because this is the one place that knows a *document*
  // has been loaded, as opposed to the text having been edited.
  if (shouldFoldFrontmatter()) foldFrontmatter(view);
  view.focus();
};

  tab.setSubtitleOld = async (text) => {
    const shadowRoot = document.getElementById(editorId)?.shadowRoot;
    const subtitle = shadowRoot?.getElementById("document-subtitle");
    let currentDir = workingDirectory.value || (isTauri ? localStorage.getItem("workingDirHandle") : await get("workingDirHandle"));
    if (subtitle) {
      let dirName = "Undefined";
      if (currentDir) {
        dirName = typeof currentDir === 'string' ? baseNameOf(currentDir) : currentDir.name;
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
          dirName = typeof currentDir === 'string' ? baseNameOf(currentDir) : currentDir.name;
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
      setEditorFileKey(editorId, null);
      clearEditorPythonSpace(editorId);
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
    setEditorFileKey(editorId, tab.currentFileKey);
    // Reached from "Save as" and from an explicit open: the file exists and is
    // ours in both cases.
    tab.fileLoaded = true;
    tab.lastLoadError = null;
    await tab.setSubtitle(tab.currentFileName);
    
    if (isTauri) {
      currentFileDir.value = typeof handleOrPath === 'string' ? dirNameOf(handleOrPath) : null;
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
          filters: [{ description: "Markdown Files", name: "Markdown", extensions: ["md", "markdown", "txt", "yml", "yaml", "ipynb"] }]
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
        types: [{
          description: "Markdown & notebooks",
          accept: { "text/markdown": [".md", ".markdown", ".txt"], "application/x-ipynb+json": [".ipynb"] },
        }],
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
        let textContent = await tauriFs.readTextFile(fileHandleOrPath);
        // A notebook is converted on the fly and the tab is mounted on the
        // sibling .md path, which may not exist yet: the first save creates it
        // and the notebook is left untouched.
        let mountedPath = fileHandleOrPath;
        if (isNotebookFile(fileHandleOrPath)) {
          textContent = convertNotebookToMyst(textContent);
          mountedPath = toMarkdownName(fileHandleOrPath);
          let clash = false;
          try { clash = await tauriFs.exists(mountedPath); } catch { /* best effort */ }
          showToast(
            clash
              ? `Notebook converted to MyST Markdown. Careful: saving overwrites the existing ${getFileName(mountedPath)}.`
              : `Notebook converted to MyST Markdown. Saving writes ${getFileName(mountedPath)}; the notebook is left untouched.`,
            clash ? "error" : "success",
            clash ? 0 : 6000,
          );
        }
        tab.fileLoaded = true;
        tab.lastLoadError = null;
        tab.currentFileHandle = mountedPath;
        tab.selectedFileHandle = mountedPath;
        tab.currentFileName = getFileName(mountedPath);
        tab.currentFileKey =  getFileKey(mountedPath);
        setEditorFileKey(editorId, tab.currentFileKey);
        clearEditorPythonSpace(editorId);
        currentFileDir.value = typeof mountedPath === 'string' ? dirNameOf(mountedPath) : null;
        // The reference the next save compares against. A notebook mounts on a
        // .md that may not exist yet, in which case this is null and the first
        // save creates the file without asking anything.
        await tab.rememberMtime(mountedPath);
        // Remember the file that actually exists on disk, so a restart reopens
        // (and reconverts) the notebook rather than a .md that is not there yet.
        localStorage.setItem(`storedFileHandle:${editorId}`, fileHandleOrPath);
        await tab.setSubtitle(tab.currentFileName);
        onFileChanged?.();
        // Simule l'objet File pour conserver la compatibilité de retour (.text())
        // Load sidecar synchronously before returning so the next render finds
        // restoredOutputCache already populated (no race with markdown render).
        const _sidecar = await loadSidecar(mountedPath);
        if (_sidecar) {
          applySidecarOutputs(_sidecar, editorId);       // sync – populates restoredOutputCache
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
        if (isNotebookFile(fileHandleOrPath)) {
          // A FileSystemFileHandle's name is read-only, so the tab cannot be
          // re-mounted on a sibling .md as it is under Tauri: it is left with no
          // write target and the first save goes through "Save as".
          const notebookText = convertNotebookToMyst(await fileData.text());
          tab.fileLoaded = false;
          tab.lastLoadError = null;
          tab.currentFileHandle = null;
          tab.selectedFileHandle = null;
          tab.currentFileName = toMarkdownName(fileHandleOrPath.name);
          tab.currentFileKey = getFileKey(fileHandleOrPath);
          setEditorFileKey(editorId, tab.currentFileKey);
          clearEditorPythonSpace(editorId);
          await set(`storedFileHandle:${editorId}`, null);
          await tab.setSubtitle(tab.currentFileName);
          onFileChanged?.();
          const nbSidecar = await loadSidecar(tab.currentFileKey);
          if (nbSidecar) {
            applySidecarOutputs(nbSidecar, editorId);
            scheduleNamespaceRestore(nbSidecar);
          }
          showToast(
            `Notebook converted to MyST Markdown. Use "Save as" to write ${tab.currentFileName}; the notebook is left untouched.`,
            "success",
            6000,
          );
          return { text: async () => notebookText };
        }
        tab.fileLoaded = true;
        tab.lastLoadError = null;
        tab.currentFileHandle = fileHandleOrPath;
        tab.selectedFileHandle = fileHandleOrPath;
        await tab.rememberMtime(fileHandleOrPath);
        tab.currentFileName = fileHandleOrPath.name;
        tab.currentFileKey =  getFileKey(fileHandleOrPath);
        setEditorFileKey(editorId, tab.currentFileKey);
        clearEditorPythonSpace(editorId);
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
          applySidecarOutputs(_sidecar, editorId);
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
        // A notebook has already been mounted (or deliberately left unbound) by
        // loadFileFromHandle: rebinding here would point the tab at the .ipynb.
        if (!isNotebookFile(fileHandleOrPath)) await tab.setCurrentFile(fileHandleOrPath);
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

  /**
   * When the file behind this tab was last written, in milliseconds.
   *
   * Returns null when the question cannot be answered -- no file yet, a
   * `<input type="file">` snapshot, a permission refused, a path that has
   * since been removed. A null is never treated as a conflict: a check that
   * cannot be made must not stop a save.
   */
  const fileMtimeMs = async (handleOrPath) => {
    try {
      if (!handleOrPath) return null;
      if (isTauri) {
        if (typeof handleOrPath !== "string") return null;
        if (!(await tauriFs.exists(handleOrPath))) return null;
        const info = await tauriFs.stat(handleOrPath);
        return info?.mtime ? new Date(info.mtime).getTime() : null;
      }
      if (typeof handleOrPath.getFile !== "function") return null;
      const file = await handleOrPath.getFile();
      return Number.isFinite(file?.lastModified) ? file.lastModified : null;
    } catch (err) {
      console.warn("[tab] could not read the modification time:", err);
      return null;
    }
  };

  /** Record the file's current modification time as the one we know about. */
  tab.rememberMtime = async (handleOrPath = tab.currentFileHandle) => {
    tab.knownMtime = await fileMtimeMs(handleOrPath);
    return tab.knownMtime;
  };

  /**
   * Has the file been written by something other than this tab?
   *
   * A second of tolerance, because a modification time does not come back
   * with the same resolution everywhere -- a filesystem that keeps whole
   * seconds, a network share that rounds -- and a save must not be questioned
   * over a rounding difference. What this catches is a real edit elsewhere:
   * another editor, a `git checkout`, a script, the same document open in a
   * second window.
   */
  const changedOnDisk = async () => {
    if (tab.knownMtime == null) return false;
    const now = await fileMtimeMs(tab.currentFileHandle);
    return now != null && Math.abs(now - tab.knownMtime) > 1000;
  };

  /** Set while a conflict is pending, so autosave warns once rather than at every tick. */
  let conflictReported = false;

  /**
   * Read the file again and put its content in the editor.
   *
   * Goes through the ordinary loading path rather than a bare read, so that a
   * reload does everything an open does -- the sidecar, the notebook
   * conversion, the file key -- instead of a careful subset of it that would
   * drift from the real one.
   */
  tab.reloadFromDisk = async () => {
    try {
      const file = await tab.loadFileFromHandle(tab.currentFileHandle);
      if (!file) return false;
      const text = await file.text();
      tab.setEditorText(text);
      tab.markSaved(text);
      await tab.rememberMtime();
      showToast(`${tab.currentFileName} reloaded from disk.`, "success", 5000);
      return true;
    } catch (err) {
      console.error("[tab] reload failed:", err);
      showToast(`${tab.currentFileName} could not be reloaded: ${err}`, "error", 0);
      return false;
    }
  };

  /**
   * What to do about a file somebody else has changed.
   *
   * Three outcomes, asked as two questions. The native dialogs of both
   * platforms -- Tauri's `ask`, the browser's `confirm` -- carry two buttons
   * and no more, and a three-way choice would mean a modal of our own, with a
   * promise to resolve from outside the component tree. Two questions in a row
   * cost nothing and are asked in the order of the stakes: keeping your work
   * first, since it is the only copy that exists nowhere else, then the
   * version on disk, with what losing it means spelt out.
   *
   * Interactive saves ask; autosave does not, because a modal that appears on
   * a timer while the user is typing is worse than the problem it reports. It
   * declines the write instead and says so once -- the text is still in the
   * editor, and an explicit save will offer the choice.
   *
   * @returns {Promise<"overwrite"|"reload"|"cancel">}
   */
  const resolveConflict = async (interactive) => {
    if (!(await changedOnDisk())) {
      conflictReported = false;
      return "overwrite";
    }

    if (!interactive) {
      if (!conflictReported) {
        conflictReported = true;
        showToast(
          `${tab.currentFileName} has changed on disk since it was opened. Autosave is holding off; ` +
            `save yourself to choose between your version and the one on disk.`,
          "warning",
          0,
        );
      }
      return "cancel";
    }

    const confirm = async (message, title, okLabel, cancelLabel) => {
      if (!isTauri) return window.confirm(`${message}\n\nOK: ${okLabel} — Cancel: ${cancelLabel}`);
      return await tauriDialog.ask(message, { title, kind: "warning", okLabel, cancelLabel });
    };

    try {
      const overwrite = await confirm(
        `${tab.currentFileName} has changed on disk since the editor last read it.\n\n` +
          `Saving replaces that version with the one in the editor, and what is on disk is lost.`,
        "The file has changed on disk",
        "Save anyway",
        "Not yet",
      );
      if (overwrite) {
        conflictReported = false;
        return "overwrite";
      }

      const reload = await confirm(
        `Load the version on disk instead?\n\n` +
          `Everything in the editor is replaced by it, including changes that were never saved. ` +
          `Cancel to leave both as they are -- you can then save under another name and compare.`,
        "Reload from disk?",
        "Reload from disk",
        "Leave both alone",
      );
      conflictReported = false;
      return reload ? "reload" : "cancel";
    } catch (err) {
      // No dialog to be had: say it and do nothing, which is the safe side.
      console.warn("[tab] could not ask about the conflict:", err);
      showToast(`${tab.currentFileName} has changed on disk; the save was not made.`, "error", 0);
      return "cancel";
    }
  };

  /** True when the write may go ahead; handles the reload branch on the way. */
  const clearedToWrite = async (interactive) => {
    const verdict = await resolveConflict(interactive);
    if (verdict === "reload") await tab.reloadFromDisk();
    // Only for a save the user asked for: on a timer, resolveConflict has
    // already said its piece once and repeating it at every tick is noise.
    if (verdict === "cancel" && interactive) {
      showToast("Save cancelled; the file on disk is untouched.", "warning", 6000);
    }
    return verdict === "overwrite";
  };

  tab.saveCurrentDoc = async ({ skipSidecar = false, interactive = true } = {}) => {
    const editorText = window.myst_editor[editorId].text;
    // Belt and braces: a tab is never mounted on a notebook, but if one ever is
    // (path param, restored handle), write notebook JSON rather than Markdown.
    const notebookTarget = isNotebookFile(tab.currentFilePathParam || tab.currentFileHandle);
    const contentToSave = notebookTarget ? convertMystToNotebook(editorText) : editorText;

    // Never write through a handle we never managed to read: the editor would
    // then be holding the new-file template, not that document's content.
    if (!tab.currentFilePathParam && tab.currentFileHandle && !tab.fileLoaded) {
      console.warn("Refusing to save to an unverified file handle:", tab.currentFileName);
      return await tab.saveAs();
    }

    if (tab.currentFilePathParam) {
      await saveFileToPathParam(tab.currentFilePathParam, contentToSave);
      tab.markSaved(editorText);
      await tab.saveCommentsForCurrentFile(); 
      console.log(`Saved (via path param): ${tab.currentFilePathParam}`);
    } else if (isTauri) {
      if (!(await clearedToWrite(interactive))) return false;
      // Before the document, not after: `myst start` watches the file and
      // rebuilds as soon as it changes, so the manifest of cell outputs has to
      // be the current one by then. See `refreshPyodideOutputs`.
      // `create` while the site is running: that is precisely when the cell
      // outputs are wanted live, and a folder that had never exported would
      // otherwise never get a manifest at all -- its site would stay mute,
      // which is the worst moment to be mute, the first one.
      await refreshPyodideOutputs(tab, { create: siteRunning() });
      await tauriFs.writeTextFile(tab.currentFileHandle, contentToSave);
      await tab.rememberMtime();
      tab.markSaved(editorText);
      await tab.saveCommentsForCurrentFile();
      if (!skipSidecar) saveSidecarWithNamespace(tab.currentFileHandle, editorId).catch(e => console.warn('[sidecar] save failed:', e));
      showToast(`Save: ${tab.currentFileName} successful.`);
      console.log(`Saved (Tauri): ${tab.currentFileName}`);
    } else if (isFallbackHandle(tab.currentFileHandle)) {
      // <input type="file"> grants no write-back permission, so the only way to
      // keep the changes is to download a copy.
      return await tab.saveAs();
    } else {
      if (!(await clearedToWrite(interactive))) return false;
      const writable = await tab.currentFileHandle.createWritable();
      await writable.write(contentToSave);
      await writable.close();
      await tab.rememberMtime();
      tab.markSaved(editorText);
      await tab.saveCommentsForCurrentFile(); 
      if (!skipSidecar) saveSidecarWithNamespace(tab.currentFileKey, editorId).catch(e => console.warn('[sidecar] save failed:', e));
      showToast(`Save: ${tab.currentFileName} successful.`);
      console.log(`Saved: ${tab.currentFileName}`);
    }
    return true;
  };

  tab.saveSidecarToFile = async () => {
    await saveSidecarToFile(tab.currentFileHandle, tab.currentFileName, editorId);
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
        await tab.saveCurrentDoc({ skipSidecar: true, interactive: false });
        // Web: IDB sidecar save is cheap — piggyback on autosave
        if (!isTauri) {
          saveSidecarWithNamespace(tab.currentFileKey, editorId)
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
          filters: [
            { name: "Markdown", extensions: ["md", "markdown", "txt", "yaml", "yml"] },
            { name: "Jupyter notebook", extensions: ["ipynb"] },
          ]
        });
        if (filePath && isNotebookFile(filePath)) {
          // Export, not a move: the tab keeps editing its Markdown target,
          // because the notebook we write carries no outputs.
          await tauriFs.writeTextFile(filePath, convertMystToNotebook(content));
          showToast(`Exported ${getFileName(filePath)} (code and text only: outputs are not included).`, "success", 6000);
          return true;
        }
        if (filePath) {
          await tauriFs.writeTextFile(filePath, content);
          await tab.setCurrentFile(filePath);
          await tab.rememberMtime(filePath);
          await addRecentFileHandle(filePath);
          tab.markSaved(content);
          await tab.saveCommentsForCurrentFile();
          saveSidecarWithNamespace(filePath, editorId).catch(e => console.warn('[sidecar] saveAs failed:', e));
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
          types: [
            { description: "Markdown Files", accept: { "text/markdown": [".md", ".markdown", ".txt", ".yaml", ".yml"] } },
            { description: "Jupyter notebook", accept: { "application/x-ipynb+json": [".ipynb"] } },
          ],
        });
        if (isNotebookFile(handle)) {
          const nbWritable = await handle.createWritable();
          await nbWritable.write(convertMystToNotebook(content));
          await nbWritable.close();
          showToast(`Exported ${handle.name} (code and text only: outputs are not included).`, "success", 6000);
          return true;
        }
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
    const asNotebook = isNotebookFile(tab.currentFileName);
    const blob = new Blob([asNotebook ? convertMystToNotebook(content) : content], {
      type: asNotebook ? "application/x-ipynb+json" : "text/markdown;charset=utf-8",
    });
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