import { get, set } from 'https://cdn.jsdelivr.net/npm/idb-keyval@6/+esm';
import { convertFileSrc } from '@tauri-apps/api/core';
import { config } from "../../config.js";
import { signal } from '@preact/signals';
import { showToast } from '../utils_ui.js';

// Helper de détection de l'environnement Tauri
export const isTauri = () => typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);

// Variables globales d'état (String sous Tauri, DirectoryHandle sous Web)
export let imagesDirectory = null;
export const workingDirectory = signal(null); // Signal WAS let workingDirectory = null
export const currentFileDir = signal(null); 

// --- Repli pour les navigateurs sans File System Access API -----------------
//
// Safari et Firefox n'implementent ni showOpenFilePicker, ni showSaveFilePicker,
// ni showDirectoryPicker.  Un <input type="file"> reste possible : il donne un
// File lisible, mais aucune permission d'ecriture et aucun acces au dossier.

/** True when the browser can hand out real FileSystemFileHandle objects. */
export const hasFileSystemAccess = () =>
  typeof window !== "undefined" && typeof window.showOpenFilePicker === "function";

/** True for a handle produced by makeFallbackFileHandle(). */
export const isFallbackHandle = (h) => Boolean(h && h.isFallback);

/**
 * Wrap a File from <input type="file"> in an object exposing the small part of
 * FileSystemFileHandle that this codebase actually uses.
 *
 * It deliberately has NO createWritable(): the browser grants no write-back
 * permission for an <input> file, so saving has to go through the download path
 * that tab.saveAs() already implements.  Callers test isFallbackHandle() rather
 * than probing for the method.
 *
 * It carries methods, so it is not structured-cloneable and must never reach
 * idb-keyval's set(); the persistence helpers below skip it.  That is also the
 * honest behaviour: the File is a snapshot, and silently restoring stale content
 * in a later session would be worse than not restoring at all.
 */
export function makeFallbackFileHandle(file) {
  return {
    kind: "file",
    name: file.name,
    isFallback: true,
    getFile: async () => file,
    queryPermission: async () => "granted",
    requestPermission: async () => "granted",
    isSameEntry: async (other) => isFallbackHandle(other) && other.name === file.name,
  };
}

/**
 * Read-only stand-in for a FileSystemDirectoryHandle, built over the flat
 * FileList that <input webkitdirectory> returns.
 *
 * The codebase only ever walks a directory with getDirectoryHandle() and
 * getFileHandle(...).getFile(), so reproducing those two methods is enough for
 * resolveImage(), copyFileToMemfs() and prestageFiles() to work unchanged --
 * they never learn this is not a real handle.
 *
 * Every mutating call ({ create: true }) throws NoModificationAllowedError, and
 * lookups that miss throw NotFoundError, mirroring what the real API does so the
 * existing try/catch blocks behave identically.
 *
 * @param {Map<string, File>} files  paths relative to the picked folder -> File
 * @param {string} name              display name of this directory level
 * @param {string} prefix            path of this level inside `files`
 */
function makeReadOnlyDirectoryHandle(files, name, prefix = "") {
  const READ_ONLY = "This folder was read as a snapshot and cannot be written to.";
  return {
    kind: "directory",
    name,
    isReadOnlySnapshot: true,

    async getDirectoryHandle(subName, options = {}) {
      if (options.create) throw new DOMException(READ_ONLY, "NoModificationAllowedError");
      const next = prefix ? `${prefix}/${subName}` : subName;
      const exists = [...files.keys()].some((path) => path.startsWith(`${next}/`));
      if (!exists) throw new DOMException(`Directory not found: ${next}`, "NotFoundError");
      return makeReadOnlyDirectoryHandle(files, subName, next);
    },

    async getFileHandle(fileName, options = {}) {
      if (options.create) throw new DOMException(READ_ONLY, "NoModificationAllowedError");
      const full = prefix ? `${prefix}/${fileName}` : fileName;
      const file = files.get(full);
      if (!file) throw new DOMException(`File not found: ${full}`, "NotFoundError");
      return {
        kind: "file",
        name: fileName,
        isFallback: true,
        getFile: async () => file,
        queryPermission: async () => "granted",
        requestPermission: async () => "granted",
      };
    },
  };
}

/** True for a working directory obtained through pickDirectoryWithInput(). */
export const isReadOnlyDirectory = (dir) => Boolean(dir && dir.isReadOnlySnapshot);

/**
 * Pick a working folder without showDirectoryPicker, via <input webkitdirectory>.
 *
 * The browser hands back every file of the folder and its subfolders in one flat
 * list, each carrying a webkitRelativePath such as "myFolder/data/quiz.yaml".
 * The first segment is the folder itself, so it is stripped to get paths
 * relative to it.  The result is a frozen, read-only snapshot.
 *
 * Resolves to a read-only directory handle, or null when the user cancels.
 */
export function pickDirectoryWithInput() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.webkitdirectory = true;
    input.setAttribute("webkitdirectory", "");
    input.style.display = "none";
    document.body.appendChild(input);

    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };

    input.addEventListener("change", () => {
      const list = Array.from(input.files || []);
      if (!list.length) return settle(null);
      const rootName = (list[0].webkitRelativePath || list[0].name).split("/")[0];
      const files = new Map();
      for (const file of list) {
        const relative = (file.webkitRelativePath || file.name).split("/").slice(1).join("/");
        if (relative) files.set(relative, file);
      }
      settle(makeReadOnlyDirectoryHandle(files, rootName));
    }, { once: true });
    input.addEventListener("cancel", () => settle(null), { once: true });
    window.addEventListener("focus", () => setTimeout(() => settle(null), 400), { once: true });

    input.click();
  });
}

/**
 * Open a local document through a transient <input type="file">.
 * Resolves to a fallback handle, or null when the user cancels.
 */
export function pickFileWithInput(accept = ".md,.markdown,.txt,.yml,.yaml") {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.style.display = "none";
    document.body.appendChild(input);

    let settled = false;
    const settle = (value) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(value);
    };

    input.addEventListener("change", () => {
      const file = input.files && input.files[0];
      settle(file ? makeFallbackFileHandle(file) : null);
    }, { once: true });
    // 'cancel' is recent (Chrome 113, Safari 16.4, Firefox 109); the focus
    // fallback covers older engines so the promise can never hang forever.
    input.addEventListener("cancel", () => settle(null), { once: true });
    window.addEventListener("focus", () => setTimeout(() => settle(null), 400), { once: true });

    input.click();
  });
}


const imageExtensions = new Set([
  "gif", "jpg", "jpeg", "png", "webp", "avif", "svg", 
  "bmp", "tif", "tiff", "ico", "heic", "heif"
]);

// --- Core storage helpers for Tab order and file handles ---

export async function saveOpenTabsOrder(tabsArray) {
  return await set("openTabsOrder", tabsArray);
}

export async function getOpenTabsOrder() {
  return await get("openTabsOrder");
}

export async function getStoredFileHandle(editorId) {
  const key = `storedFileHandle:${editorId}`;
  let stored = await get(key);
  if (!stored && typeof localStorage !== 'undefined') {
    stored = localStorage.getItem(key);
  }
  return stored;
}

export async function setStoredFileHandle(editorId, handleOrPath) {
  const key = `storedFileHandle:${editorId}`;
  if (typeof handleOrPath === 'string') {
    localStorage.setItem(key, handleOrPath);
  }
  await set(key, handleOrPath);
}

// --- Sélection des dossiers (Images & Working Directory) ---

export async function selectImageFolder() {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      imagesDirectory = selected;
      localStorage.setItem("imagesDirHandle", imagesDirectory);
      console.log("Folder selected and saved (Tauri):", imagesDirectory);
    }
  } else {
    if ('showDirectoryPicker' in window) {
      try {
        imagesDirectory = await window.showDirectoryPicker();
        await set("imagesDirHandle", imagesDirectory);
        console.log("Folder selected and saved (Web):", imagesDirectory.name);
      } catch (err) {
        if (err.name !== 'AbortError') console.error("Error selecting folder (Web):", err);
      }
    }
  }
}

export async function loadImageFolderOnStartup() {
  if (isTauri()) {
    const storedPath = localStorage.getItem("imagesDirHandle");
    if (storedPath) {
      imagesDirectory = storedPath;
      return imagesDirectory;
    }
  } else {
    const storedHandle = await get("imagesDirHandle");
    if (storedHandle) {
      imagesDirectory = storedHandle;
      return imagesDirectory;
    }
  }
  return null;
}

export async function selectWorkingFolder() {
  if (isTauri()) {
    const { open } = await import('@tauri-apps/plugin-dialog');
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      workingDirectory.value = selected;                        
      localStorage.setItem("workingDirHandle", selected);
      console.log("Working folder selected and saved (Tauri):", workingDirectory.value);
    }
  } else {
    if ('showDirectoryPicker' in window) {
      try {
        const handle = await window.showDirectoryPicker();
        workingDirectory.value = handle;                       
        await set("workingDirHandle", handle);
        console.log("Working folder selected and saved (Web):", workingDirectory.value.name);
      } catch (err) {
        if (err.name !== 'AbortError') console.error("Error selecting working folder (Web):", err);
      }
    } else {
      // Safari and Firefox have no showDirectoryPicker.  <input webkitdirectory>
      // still opens a native folder picker, but yields only a read-only snapshot.
      const snapshot = await pickDirectoryWithInput();
      if (snapshot) {
        workingDirectory.value = snapshot;
        // Deliberately not persisted: it carries methods (not structured-
        // cloneable) and is a frozen snapshot, so restoring it later would serve
        // stale content.  The folder has to be picked again each session.
        console.log("Working folder read as a snapshot (Web, no FS Access API):", snapshot.name);
        showToast(
          "Folder read in snapshot mode: images and data files are readable, but this browser cannot write anything back, will not see later changes on disk, and will ask for the folder again next session. Use Chrome or Edge for full access.",
          "error",
          // 0 = stays until dismissed: a structural limitation worth reading in
          // full, rather than a timer racing the user.
          0
        );
      }
    }
  }
}

export async function loadWorkingFolderOnStartup() {
  if (isTauri()) {
    const storedPath = localStorage.getItem("workingDirHandle");
    if (storedPath) {
      workingDirectory.value = storedPath;
      return workingDirectory;
    }
  } else {
    const storedHandle = await get("workingDirHandle");
    if (storedHandle) {
      workingDirectory.value = storedHandle;
      return workingDirectory;
    }
  }
  return null;
}

export function getWorkingDirectory() {
  return workingDirectory;
}

// --- Résolution des images (Web vs Tauri) ---

export async function resolveImage(path) {
  // Gardes communes (inchangées)
  if (
    !path ||
    /^(https?:|data:|blob:|mailto:|asset:)/i.test(path) ||
    path.startsWith("https://asset.localhost")
  ) return path;

  const extension = path.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase();
  if (!imageExtensions.has(extension)) return path;

  if (isTauri()) {
    const { exists } = await import('@tauri-apps/plugin-fs');
    const cleanPath = path.replace(/^\.?\//, "").replaceAll("\\", "/");
    //const candidates = [currentFileDir.value, workingDirectory.value].filter(Boolean);
    const candidates = [currentFileDir.value].filter(Boolean);

    for (const dir of candidates) {
      const absolutePath = `${dir.replace(/\/$/, "")}/${cleanPath}`;
      if (await exists(absolutePath)) {
        return convertFileSrc(absolutePath).replaceAll("%2F", "/");
      }
    }
    return config.fallbackImage;
  }

  // Web (inchangé)
  if (!workingDirectory.value) return path;
  try {
    const parts = path.replace(/^\.?\//, "").replaceAll("\\", "/").split("/").filter(Boolean);
    const fileName = parts.pop();
    let directory = workingDirectory.value;
    for (const part of parts) {
      directory = await directory.getDirectoryHandle(part);
    }
    const handle = await directory.getFileHandle(fileName);
    const file = await handle.getFile();
    return URL.createObjectURL(file);
  } catch (err) {
    console.error("Image not found (Web):", path, err);
    return config.fallbackImage;
  }
}

export function resolveImageSync(path) {
  return resolveImage(path)
}

// ----

export function resolveImageSyncOld(path) {
  // 1. Return immediately if empty or already an absolute/converted URL (http, https, blob, data, asset://)
  if (
    !path || 
    /^(https?:|data:|blob:|mailto:|asset:)/i.test(path) ||
    path.startsWith("https://asset.localhost")
  ) {
    return path;
  }

  const extension = path.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase();
  if (!imageExtensions.has(extension)) return path;
  if (!workingDirectory.value) return config.fallbackImage;

  if (isTauri()) {
    try {
      let rawWorkingDir = typeof workingDirectory.value === 'string' 
        ? decodeURIComponent(workingDirectory.value) 
        : workingDirectory.value;

      const cleanWorkingDir = rawWorkingDir.replace(/\/$/, "");
      const cleanRelativePath = path.replace(/^\.?\//, "").replaceAll("\\", "/");
      const absolutePath = `${cleanWorkingDir}/${cleanRelativePath}`;

      let assetUrl = convertFileSrc(absolutePath);
      if (assetUrl.includes("%2F")) {
        assetUrl = assetUrl.replaceAll("%2F", "/");
      }
      return assetUrl;
    } catch (err) {
      console.error("Error resolving image synchronously with Tauri:", err);
      return config.fallbackImage;
    }
  }

  // Sous Web : la résolution synchrone retourne le fallback si non pré-traité par resolveImage
  return config.fallbackImage;
}

export async function resolveImageOld(path) {
  if (!path || /^(https?:|data:|blob:|mailto:)/i.test(path)) return path;

  const extension = path.split("?")[0].split("#")[0].split(".").pop()?.toLowerCase();
  if (!imageExtensions.has(extension)) return path;
  if (!workingDirectory.value) return path + " (no work dir)";

  if (isTauri()) {
    return resolveImageSync(path);
  } else {
    try {
      const parts = path.replace(/^\.?\//, "").replaceAll("\\", "/").split("/").filter(Boolean);
      const fileName = parts.pop();
      let directory = workingDirectory.value;
      for (const part of parts) {
        directory = await directory.getDirectoryHandle(part);
      }
      const handle = await directory.getFileHandle(fileName);
      const file = await handle.getFile();
      return URL.createObjectURL(file);
    } catch (err) {
      console.error("Image not found (Web):", path, err);
      return config.fallbackImage;
    }
  }
}

// --- Fichiers récents ---

export async function getRecentFileHandles() {
  if (isTauri()) {
    const raw = localStorage.getItem("recentFileHandles");
    return raw ? JSON.parse(raw) : [];
  } else {
    const handles = await get("recentFileHandles");
    return Array.isArray(handles) ? handles : [];
  }
}

/**
 * Drop entries of the recent-files list that no longer point at an existing
 * file. Under Tauri the entries are absolute paths, so existence is a cheap
 * filesystem check. On the web they are FileSystemFileHandle objects: we only
 * probe the ones whose permission is already granted, so that pruning never
 * triggers a permission prompt, and we only discard a handle when the browser
 * explicitly reports the file as missing (NotFoundError). Anything we cannot
 * decide is kept.
 * Returns the surviving list.
 */
let recentPrunePromise = null;

/** Prune the recent-files list at most once per session (startup helper). */
export function pruneRecentFileHandlesOnce() {
  if (!recentPrunePromise) {
    recentPrunePromise = pruneRecentFileHandles().catch((e) => {
      console.warn("[recent] pruning failed", e);
      return null;
    });
  }
  return recentPrunePromise;
}

export async function pruneRecentFileHandles() {
  const handles = await getRecentFileHandles();
  if (!handles.length) return handles;

  const survivors = [];
  if (isTauri()) {
    const { exists } = await import('@tauri-apps/plugin-fs');
    for (const path of handles) {
      if (typeof path !== "string" || !path) continue;
      try {
        if (await exists(path)) survivors.push(path);
      } catch (e) {
        // Unreadable location (permissions, unmounted volume): keep the entry.
        survivors.push(path);
      }
    }
    if (survivors.length !== handles.length) {
      localStorage.setItem("recentFileHandles", JSON.stringify(survivors));
    }
  } else {
    for (const handle of handles) {
      if (!handle || typeof handle.getFile !== "function") continue;
      let alive = true;
      try {
        const permission = typeof handle.queryPermission === "function"
          ? await handle.queryPermission({ mode: "read" })
          : "granted";
        if (permission === "granted") {
          await handle.getFile();
        }
      } catch (e) {
        if (e && e.name === "NotFoundError") alive = false;
      }
      if (alive) survivors.push(handle);
    }
    if (survivors.length !== handles.length) {
      await set("recentFileHandles", survivors);
    }
  }

  if (survivors.length !== handles.length) {
    console.log(`[recent] pruned ${handles.length - survivors.length} stale entr${handles.length - survivors.length > 1 ? "ies" : "y"}`);
  }
  return survivors;
}

export async function addRecentFileHandle(fileHandleOrPath) {
  if (isTauri()) {
    const recentHandles = await getRecentFileHandles();
    const filtered = recentHandles.filter(p => p !== fileHandleOrPath);
    filtered.unshift(fileHandleOrPath);
    localStorage.setItem("recentFileHandles", JSON.stringify(filtered));
    return filtered;
  } else {
    // A fallback handle carries methods (not structured-cloneable) and is only a
    // snapshot, so it never joins the persisted recent list.
    if (isFallbackHandle(fileHandleOrPath)) return await getRecentFileHandles();
    const recentHandles = await getRecentFileHandles();
    // Filtrage pour éviter les doublons avec les FileSystemHandle Web
    const filtered = [];
    for (const item of recentHandles) {
      const isSame = typeof item.isSameEntry === 'function' && typeof fileHandleOrPath.isSameEntry === 'function'
        ? await item.isSameEntry(fileHandleOrPath)
        : item === fileHandleOrPath;
      if (!isSame) filtered.push(item);
    }
    filtered.unshift(fileHandleOrPath);
    await set("recentFileHandles", filtered);
    return filtered;
  }
}

// --- Chargement / Sauvegarde des fichiers ---

export async function loadFileFromPathParam() {
  const params = new URLSearchParams(location.search);
  const filePath = params.get("path");
  if (!filePath) return null;
  
  if (isTauri()) {
    try {
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      const content = await readTextFile(filePath);
      return { path: filePath, content };
    } catch (err) {
      console.error("Failed to load file from path param (Tauri):", err);
      return null;
    }
  }
  return null;
}

export async function saveFileToPathParam(filePath, content) {
  if (isTauri()) {
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(filePath, content);
  }
}

/**
 * Creates a backup copy of the current file by replacing its extension with .bak
 * @param {string|FileSystemFileHandle} currentHandleOrPath - Web handle or Tauri file path
 * @param {string} content - The text content to write into the backup
 */
export async function saveBackupFile(currentHandleOrPath, content) {
  if (!currentHandleOrPath) return false;

  if (isTauri()) {
    try {
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      
      const backupPath = typeof currentHandleOrPath === 'string'
        ? currentHandleOrPath.replace(/\.[^/.]+$/, "") + ".bak"
        : null;

      if (!backupPath) return false;

      await writeTextFile(backupPath, content);
      console.log("Tauri backup created:", backupPath);
      return true;
    } catch (err) {
      console.error("Backup error (Tauri):", err);
      return false;
    }
  } else {
    try {
      // Web environment: fallback to workingDirectory or prompt using showSaveFilePicker
      if (typeof currentHandleOrPath === 'object' && currentHandleOrPath.name) {
        const originalName = currentHandleOrPath.name;
        const backupName = originalName.replace(/\.[^/.]+$/, "") + ".bak";

        // 1. Primary approach: write inside workingDirectory if available.
        //    A snapshot directory has getFileHandle() but cannot create anything,
        //    so skip straight to the showSaveFilePicker/download path below.
        if (workingDirectory.value
            && !isReadOnlyDirectory(workingDirectory.value)
            && typeof workingDirectory.value.getFileHandle === 'function') {
          const backupHandle = await workingDirectory.value.getFileHandle(backupName, { create: true });
          const writable = await backupHandle.createWritable();
          await writable.write(content);
          await writable.close();
          console.log("Web backup created inside workingDirectory:", backupName);
          return true;
        }

        // 2. Fallback approach: prompt user via standard File System Access API
        if ('showSaveFilePicker' in window) {
          const backupHandle = await window.showSaveFilePicker({
            suggestedName: backupName,
            types: [{
              description: 'Backup File',
              accept: { 'text/plain': ['.bak'] }
            }]
          });
          const writable = await backupHandle.createWritable();
          await writable.write(content);
          await writable.close();
          console.log("Web backup created via save picker:", backupName);
          return true;
        }
      }
      return false;
    } catch (err) {
      if (err.name === 'AbortError') {
        console.log("Backup cancelled by user.");
      } else {
        console.error("Backup error (Web):", err);
      }
      return false;
    }
  }
}