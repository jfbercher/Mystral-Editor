/**
 * Sidecar persistence — Pyodide cell outputs and namespace.
 * Tauri: sidecar file co-located with .md  (<name>.myst.cache.json)
 * Web:   IndexedDB entry keyed by stable fileKey (workspaceName_fileName)
 */
import { get as idbGet, set as idbSet } from "idb-keyval";
import { isTauri, workingDirectory } from "./fs.js";
import {
  cellCache,
  OWNER_SEP,
  restoredOutputCache,
  isPyodideReady,
  loadPyodideRuntime,
  snapshotNamespace,
  restoreNamespace,
} from "../../markdown/pyodideRunner";
import { evalCache } from "../../markdown/markdownPyodide";

// ── Path / key helpers ────────────────────────────────────────────────────────

/** /path/to/doc.md → /path/to/doc.myst.cache.json  (Tauri only) */
function getSidecarPath(filePath) {
  return filePath.replace(/(\.[^./]+)?$/, ".myst.cache.json");
}

/** IndexedDB key prefix for web sidecar storage. */
const IDB_SIDECAR_PREFIX = 'myst:sidecar:';

// ── Disk / IDB I/O ────────────────────────────────────────────────────────────

/**
 * Read sidecar JSON, or null if absent / unreadable.
 * @param {string} fileKeyOrPath  Tauri: absolute path; Web: stable fileKey string
 */
export async function loadSidecar(fileKeyOrPath) {
  if (!fileKeyOrPath) return null;
  if (isTauri()) {
    const path = getSidecarPath(fileKeyOrPath);
    try {
      const { readTextFile } = await import("@tauri-apps/plugin-fs");
      const text = await readTextFile(path);
      console.log("[sidecar] loaded from file:", path);
      return JSON.parse(text);
    } catch {
      return null; // file not found — normal on first open
    }
  } else {
    try {
      const data = await idbGet(IDB_SIDECAR_PREFIX + fileKeyOrPath);
      if (data) console.log("[sidecar] loaded from IndexedDB:", fileKeyOrPath);
      return data ?? null;
    } catch {
      return null;
    }
  }
}

/** Write sidecar JSON (Tauri: file; Web: IndexedDB). */
async function writeSidecar(fileKeyOrPath, data) {
  if (isTauri()) {
    const path = getSidecarPath(fileKeyOrPath);
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    await writeTextFile(path, JSON.stringify(data, null, 2));
  } else {
    await idbSet(IDB_SIDECAR_PREFIX + fileKeyOrPath, data);
  }
}

// ── Web-filesystem helpers (workingDirectory) ────────────────────────────────

/** Derive sidecar filename from a markdown filename: foo.md → foo.myst.cache.json */
function getSidecarName(fileName) {
  return fileName.replace(/(\.[^./]+)?$/, ".myst.cache.json");
}

/**
 * Write sidecar JSON to workingDirectory as a real file (web only).
 * Returns true on success, false if workingDirectory unavailable.
 */
async function writeSidecarToWorkdir(fileName, data) {
  const dir = workingDirectory.value;
  if (!dir) return false;
  // A folder read through <input webkitdirectory> is a read-only snapshot:
  // report failure the same way a missing folder does, rather than throwing.
  if (dir.isReadOnlySnapshot) return false;
  const sidecarName = getSidecarName(fileName);
  const fh = await dir.getFileHandle(sidecarName, { create: true });
  const writable = await fh.createWritable();
  await writable.write(JSON.stringify(data, null, 2));
  await writable.close();
  return true;
}

/**
 * Read sidecar JSON from workingDirectory (web only).
 * Returns parsed object or null.
 */
async function loadSidecarFromWorkdir(fileName) {
  const dir = workingDirectory.value;
  if (!dir) return null;
  const sidecarName = getSidecarName(fileName);
  try {
    const fh = await dir.getFileHandle(sidecarName);
    const file = await fh.getFile();
    return JSON.parse(await file.text());
  } catch {
    return null;
  }
}

/**
 * Explicit "Save with Python outputs" action: writes sidecar as a real file
 * in workingDirectory (web), or the standard filesystem sidecar path (Tauri).
 * Called from the editor menu — never from autosave.
 * @param {string} filePath   Tauri: absolute path; Web: ignored (uses currentFileName)
 * @param {string} fileName   Current document filename (e.g. "document.md")
 */
export async function saveSidecarToFile(filePath, fileName, space = "shared", editorId = "") {
  const cells = collectCellOutputs(editorId);
  if (Object.keys(cells).length === 0) {
    console.log("[sidecar] no cell outputs to save — skipping");
    return;
  }

  const data = {
    version: 1,
    saved_at: new Date().toISOString(),
    cells,
    namespace: null,
  };

  if (isPyodideReady()) {
    try {
      data.namespace = await snapshotNamespace(space);
    } catch (e) {
      console.warn("[sidecar] namespace snapshot failed:", e);
    }
  }

  data.python_space = space;
  const n = Object.keys(cells).length;
  const nsCount = data.namespace ? Object.keys(data.namespace).length : 0;

  try {
    if (isTauri()) {
      await writeSidecar(filePath, data);
    } else {
      const ok = await writeSidecarToWorkdir(fileName, data);
      if (!ok) {
        // Fallback to IDB when workingDirectory not yet granted
        await idbSet(IDB_SIDECAR_PREFIX + fileName, data);
        console.log(`[sidecar] saved to IndexedDB (no workingDirectory): ${n} cell(s)${nsCount ? `, ${nsCount} vars` : ""}`);
        return;
      }
    }
    console.log(`[sidecar] saved to file: ${n} cell(s)${nsCount ? `, ${nsCount} vars` : ""}`);
  } catch (e) {
    console.warn("[sidecar] saveSidecarToFile failed:", e);
  }
}

// ── Apply on load ─────────────────────────────────────────────────────────────

/**
 * Populate restoredOutputCache from sidecar data (synchronous).
 * Must be called BEFORE the markdown is rendered so that initCodeCell()
 * picks up the stored outputs on first render.
 */
export function applySidecarOutputs(sidecar, editorId = "") {
  if (!sidecar?.cells) return;
  // The sidecar keys a cell by its code; the runtime cache keys it by code and
  // owning editor, so the outputs are filed under this editor -- otherwise a
  // document would light up the identical cell of the document next to it.
  for (const [cacheKey, entry] of Object.entries(sidecar.cells)) {
    if (entry.output_html) restoredOutputCache.set(editorId + OWNER_SEP + cacheKey, entry.output_html);
  }
}

/**
 * Fire-and-forget: pre-initialize Pyodide, then restore the namespace.
 * Safe to call immediately after applySidecarOutputs().
 */
export function scheduleNamespaceRestore(sidecar, space = "shared") {
  if (!sidecar) return;
  // A snapshot belongs to the namespace it was taken from, so that is where it
  // goes back. This matters when a document's `python:` has changed since it
  // was saved: the variables return to the namespace they were computed in --
  // the old one -- rather than being poured into the new one, which would carry
  // a shared pot's contents into a namespace meant to be separate. The cells
  // now run elsewhere and have to be re-run, which is what changing the
  // namespace means. A sidecar written before this field existed says nothing,
  // and "shared" is what it meant.
  const target = sidecar.python_space ?? space;
  const hasCells = Object.keys(sidecar.cells ?? {}).length > 0;
  if (!hasCells && !sidecar.namespace) return;

  loadPyodideRuntime()
    .then(async () => {
      if (sidecar.namespace) {
        await restoreNamespace(sidecar.namespace, target);
        console.log(`[sidecar] namespace restored into ${target}`);
      }
      // Always clear eval cache after Pyodide is ready + sidecar loaded,
      // so {eval} expressions that errored before namespace was ready re-evaluate.
      // evalCache.clear() triggers onChange → scheduleRender → fresh evaluation.
      evalCache.clear();
    })
    .catch((e) => console.warn("[sidecar] namespace restore failed:", e));
}

// ── Collect for save ──────────────────────────────────────────────────────────

/**
 * This document's cell outputs.
 * The cache is shared by every editor and its keys carry the owning editor, so
 * the others are skipped here and the prefix is stripped: what the sidecar
 * stores stays keyed by the cell's code, as it has always been.
 */
function collectCellOutputs(editorId = "") {
  const cells = {};
  const prefix = editorId + OWNER_SEP;
  for (const [cacheKey, el] of cellCache.entries()) {
    if (!cacheKey.startsWith(prefix)) continue;
    const out = el.querySelector(".pyodide-output");
    if (!out || out.hidden || !out.innerHTML.trim()) continue;
    const key = cacheKey.slice(prefix.length);
    cells[key] = { output_html: out.innerHTML, source_hash: key };
  }
  return cells;
}

// ── Save on explicit save ─────────────────────────────────────────────────────

/**
 * Save sidecar with cell outputs + namespace snapshot.
 * Call only on explicit user save (Cmd+S, Save As) — NOT on autosave.
 * @param {string} fileKeyOrPath  Tauri: absolute path; Web: stable fileKey string
 */
export async function saveSidecarWithNamespace(fileKeyOrPath, space = "shared", editorId = "") {
  if (!fileKeyOrPath) return;

  const cells = collectCellOutputs(editorId);
  if (Object.keys(cells).length === 0) return; // no code cells → skip

  const data = {
    version: 1,
    saved_at: new Date().toISOString(),
    cells,
    namespace: null,
  };

  if (isPyodideReady()) {
    try {
      data.namespace = await snapshotNamespace(space);
    } catch (e) {
      console.warn("[sidecar] namespace snapshot failed:", e);
    }
  }
  data.python_space = space;

  try {
    await writeSidecar(fileKeyOrPath, data);
    const n = Object.keys(cells).length;
    const ns = data.namespace ? `, ${Object.keys(data.namespace).length} namespace vars` : "";
    console.log(`[sidecar] saved: ${n} cell(s)${ns}`);
  } catch (e) {
    console.warn("[sidecar] write failed:", e);
  }
}
