/**
 * Hand the outputs of the Pyodide cells to mystmd, for a static export.
 *
 * mystmd builds the shape already: a `{code-cell}` becomes a block holding a
 * `code` node and an **empty** `outputs` node beside it, even for a document
 * nothing ever executed. The plugin in `extras/myst-plugins/pyodide-outputs.mjs`
 * fills those nodes; this writes what it needs -- the images as files, and a
 * manifest pairing each cell's source with its outputs.
 *
 * Why the source as the key, rather than the hash the cells are cached under:
 * the plugin would then have to reproduce that hash exactly, and two
 * implementations of one function are two things that drift. Comparing the
 * code itself costs a few kilobytes of manifest and cannot be wrong.
 *
 * Why PNG. The figures are SVG with their fonts converted to paths, which is
 * right for the screen and for a zoom, and is neither includable by LaTeX
 * without outside tooling nor among the MIME types the web theme renders
 * directly. They are rasterised here rather than kept in both formats at run
 * time: the sidecar is read whenever a document is opened, and doubling it for
 * an export that may never happen is a poor trade. The SVG stays the source of
 * truth, so producing vector PDFs instead, the day a converter can be relied
 * on, remains open.
 */

import { config } from "../../config.js";
import { cellCache, OWNER_SEP } from "../../markdown/pyodideRunner.js";
import { decodeCode } from "../../markdown/markdownPyodide.js";
import { documentFrontmatter, projectFrontmatter } from "../../markdown/frontmatterUtils.js";

/** Where the manifest and the images are written, under the document's folder. */
export const PYODIDE_BUILD_DIR = "_build/pyodide";

/** What was last written for a folder, so that an unchanged document is free. */
const lastWritten = new Map();
export const PYODIDE_MANIFEST = "pyodide-outputs.json";

/**
 * The outputs of one cell, read from its rendered output area.
 *
 * Read from the DOM rather than from the sidecar: the sidecar holds the same
 * HTML, but the DOM is what the author is looking at, and a cell run since the
 * last save is in one and not the other.
 */
/**
 * The code a cell holds *now*, which is not always what `data-code` says.
 *
 * `data-code` is stamped when the host is built and never restamped while it
 * lives -- deliberately, since rebuilding the host on every keystroke would
 * take the cell's editor, its outputs and its place in the kernel with it. So
 * a cell whose code has been edited in place keeps advertising the code it was
 * created with.
 *
 * That is only a label until something matches on it: the manifest is keyed by
 * the code, and the plugin looks the cell up by the code mystmd reads from the
 * document. Editing a cell therefore left the manifest holding an entry no
 * document would ever claim, and the figure vanished from every export while
 * the editor went on showing it. The cell's own editor is the authority; the
 * attribute is the fallback, for a host that has been put aside and no longer
 * carries one.
 */
function codeOf(el) {
  const live = el?.querySelector?.(".pyodide-editor");
  // Trusted even when it is empty: a cell someone has just cleared holds no
  // code, and falling back to the attribute would put the code it used to
  // have into the manifest.
  if (live && typeof live.value === "string") return live.value;
  return el?.dataset?.code ? decodeCode(el.dataset.code) : "";
}

function outputsOf(el, filters) {
  const area = el.querySelector(".pyodide-output");
  if (!area || area.hidden) return [];

  const outputs = [];
  for (const node of area.querySelectorAll("pre, img.pyodide-figure")) {
    if (node.tagName === "IMG") {
      const src = node.getAttribute("src") ?? "";
      if (src.startsWith("data:")) outputs.push({ type: "image", dataUrl: src });
    } else {
      const value = node.textContent ?? "";
      const stream = node.className.replace("pyodide-", "");
      // An empty `<pre>` carries nothing to a PDF but an empty frame.
      if (!value.trim()) continue;
      if (filters.stderr === "remove" && (stream === "stderr" || stream === "error")) continue;
      if (filters.stdout === "remove" && stream === "stdout") continue;
      // `output_matplotlib_strings` is about the `<Figure size ...>` line a
      // notebook prints beside its figure, which is noise beside the figure
      // itself. mystmd removes it by default; so do we.
      if (filters.matplotlib !== "show" && MATPLOTLIB_NOISE.test(value.trim())) continue;
      outputs.push({ type: "text", value, stream });
    }
  }
  return outputs;
}

/** The repr matplotlib prints alongside a figure, which says nothing. */
const MATPLOTLIB_NOISE = /^(<Figure\s+size[^>]*>|\[<matplotlib\.[^\]]*>\]|<matplotlib\.[^>]*>)$/;

/**
 * The output filters in force, as mystmd names them.
 *
 * `output_stdout`, `output_stderr` and `output_matplotlib_strings` are project
 * settings mystmd applies to the outputs it executes itself. Ours never go
 * through that transform -- they arrive already rendered -- so the same
 * settings are honoured here, from the document's frontmatter or the project's.
 */
function outputFilters(tab) {
  // The text as it stands in the editor, the same way mystExport.js reads it:
  // the export runs on what is on screen, saved a moment earlier.
  const text = (typeof window !== "undefined" && window.myst_editor?.[tab?.editorId]?.text) || "";
  const settings = { ...(projectFrontmatter()?.settings ?? {}), ...(documentFrontmatter(text)?.settings ?? {}) };
  return {
    stdout: String(settings.output_stdout ?? "").trim(),
    stderr: String(settings.output_stderr ?? "").trim(),
    matplotlib: String(settings.output_matplotlib_strings ?? "").trim(),
  };
}

/**
 * Draw a data URL into a canvas and return PNG bytes.
 *
 * An SVG has to be given an explicit size before it is drawn: without one the
 * result depends on the engine, and a figure comes out at some default size
 * rather than its own. matplotlib writes `width`/`height` in points on the
 * root element, and a `viewBox` -- the viewBox is the reliable one, the units
 * of the other two being whatever the writer chose.
 *
 * @returns {Promise<{bytes: Uint8Array, width: number, height: number}|null>}
 */
async function rasterise(dataUrl, scale) {
  const img = new Image();
  const loaded = new Promise((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("the figure could not be decoded"));
  });
  img.src = dataUrl;
  await loaded;

  let { width, height } = img;
  if (!width || !height) {
    // Firefox and WebKit report 0 for an SVG without intrinsic size; take the
    // viewBox instead.
    const svg = dataUrl.startsWith("data:image/svg+xml;base64,")
      ? atob(dataUrl.slice("data:image/svg+xml;base64,".length))
      : "";
    const box = /viewBox\s*=\s*["']\s*[\d.+-]+[,\s]+[\d.+-]+[,\s]+([\d.+-]+)[,\s]+([\d.+-]+)/i.exec(svg);
    width = box ? Number(box[1]) : 640;
    height = box ? Number(box[2]) : 480;
  }

  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const ctx = canvas.getContext("2d");
  // A PNG keeps transparency, and a figure drawn for a light page on a
  // transparent background is unreadable the day it lands on a dark one.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) return null;
  return { bytes: new Uint8Array(await blob.arrayBuffer()), width: canvas.width, height: canvas.height };
}

/** Bytes of a data URL that is already a PNG, without going through a canvas. */
function decodePng(dataUrl) {
  const comma = dataUrl.indexOf(",");
  const raw = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

/**
 * Write the images and the manifest under the document's folder.
 *
 * @param {object} tab
 * @param {string} dir  the document's folder
 * @returns {Promise<{cells: number, images: number}|null>} null when there is nothing to write
 */
export async function writePyodideOutputs(tab, dir, preview = null) {
  const editorId = tab?.editorId;
  if (!editorId) return null;

  const prefix = editorId + OWNER_SEP;
  const scale = Number(config.pyodide?.exportImageScale) > 0 ? Number(config.pyodide.exportImageScale) : 2;

  const filters = outputFilters(tab);
  const cells = [];
  const files = [];

  // The hosts on screen first, the cached ones after.
  //
  // `cellCache` holds the hosts put aside by a re-render, so it carries what a
  // cell looked like the last time one happened -- not what it looks like now.
  // Reading only from it meant that re-running a cell, or editing it, removed
  // its figure from the site and the PDF while the editor went on showing it,
  // and that quitting and reloading brought it back: the restore from the
  // sidecar, followed by a render, refilled the cache. The live host is the
  // one holding the truth; the cache is the fallback, for a cell that is not
  // mounted at this moment.
  const entries = [];
  const covered = new Set();
  const signature = [];
  const live = [...(preview?.querySelectorAll?.(".code-cell-host") ?? [])].filter((h) => h.id);
  for (const host of live) entries.push([host.id, host, "live"]);
  const cached = [...cellCache.entries()].filter(([key]) => key.startsWith(prefix));
  for (const [key, el] of cached) entries.push([key.slice(prefix.length), el, "cache"]);
  console.debug(`[export] cells seen: ${live.length} live, ${cached.length} cached`);

  // First pass: what each cell holds, read from the DOM and nothing more.
  // Cheap, and enough to tell whether anything has changed since the last
  // write -- which is what makes it affordable to do this on every save.
  const found = [];
  for (const [id, el, where] of entries) {
    const code = codeOf(el);
    if (!code.trim()) continue;
    // Two entries for one cell -- the live host and its cached copy -- and the
    // first wins, which by the order above is the live one.
    if (covered.has(code.trim())) continue;

    // Geometry only. `:caption:` and `:label:` are not passed on: mystmd reads
    // the document's source, sees them on the `{code-cell}`, and wraps the
    // code and its outputs in a figure of its own that carries them. Sending
    // them here too produced two nested floats and the caption twice.
    const host = el.closest?.(".code-cell-host") ?? el;
    const figure = {
      width: host.dataset?.figwidth?.trim() || (config.pyodide?.figureWidth ?? "").trim() || null,
      align: host.dataset?.align?.trim() || "center",
    };
    const raw = outputsOf(el, filters);
    const area = el.querySelector?.(".pyodide-output");
    console.debug(
      `[export] cell ${id} (${where}): ${code.trim().length} chars of code, ${raw.length} output(s)` +
        `, output area ${area ? (area.hidden ? "hidden" : "visible") : "absent"}`,
    );
    // Marked as covered only once it has something to contribute: a live host
    // that has been re-rendered and not yet re-run holds no output at all, and
    // marking it here would hide the cached copy that still has one.
    if (!raw.length) continue;
    covered.add(code.trim());
    found.push({ id, code: code.trim(), figure, raw });
    signature.push(code.trim(), ...raw.map((o) => (o.type === "image" ? o.dataUrl : `${o.stream}:${o.value}`)));
  }

  const stamp = signature.join("\u0000");
  const { exists } = await import("@tauri-apps/plugin-fs");
  const manifestPath = `${dir}/${PYODIDE_BUILD_DIR}/${PYODIDE_MANIFEST}`;
  // Unchanged, and the files are still there: the PNGs would be re-encoded
  // byte for byte and the manifest rewritten identically.
  if (found.length && lastWritten.get(dir) === stamp && (await exists(manifestPath))) {
    console.debug("[export] manifest unchanged, left as it is");
    return { cells: found.length, unchanged: true };
  }

  // Second pass, the expensive one: an SVG figure is rasterised here.
  for (const { id, code, figure, raw } of found) {
    const outputs = [];
    for (const out of raw) {
      if (out.type === "text") {
        outputs.push({ type: "text", value: out.value, stream: out.stream });
        continue;
      }
      try {
        const png = out.dataUrl.startsWith("data:image/png") ? { bytes: decodePng(out.dataUrl) } : await rasterise(out.dataUrl, scale);
        if (!png) continue;
        // Named from the cell and its rank, so a second export overwrites its
        // own files instead of piling up.
        const name = `${id}-${files.length}.png`;
        files.push({ name, bytes: png.bytes });
        outputs.push({ type: "image", path: `${PYODIDE_BUILD_DIR}/${name}`, width: figure.width, align: figure.align });
      } catch (err) {
        console.warn("[export] a figure could not be converted:", err);
      }
    }
    if (outputs.length) cells.push({ code, outputs });
  }

  console.debug(`[export] manifest: ${cells.length} cell(s), ${files.length} image(s)`);
  if (!cells.length) return null;

  const { mkdir, writeFile, writeTextFile } = await import("@tauri-apps/plugin-fs");
  await mkdir(`${dir}/${PYODIDE_BUILD_DIR}`, { recursive: true }).catch(() => {});
  for (const file of files) await writeFile(`${dir}/${PYODIDE_BUILD_DIR}/${file.name}`, file.bytes);
  await writeTextFile(
    `${dir}/${PYODIDE_BUILD_DIR}/${PYODIDE_MANIFEST}`,
    JSON.stringify({ version: 1, written_at: new Date().toISOString(), cells }, null, 1),
  );
  lastWritten.set(dir, stamp);

  return { cells: cells.length, images: files.length };
}

/**
 * Keep the manifest in step with the cells, on save.
 *
 * It used to be written only by an export, and `myst start` watches the
 * document: saving rebuilt the site from a manifest that still held the
 * previous run's figures, so a re-executed cell showed its old output -- or
 * none -- until a PDF export happened to rewrite the file. Refreshing here,
 * *before* the document is written, means the rebuild that the save triggers
 * reads what the cells hold now.
 *
 * Only for a document that has one already: a folder that has never exported
 * has no `_build/pyodide`, and saving is not the moment to create one. An
 * unchanged document costs one DOM read, no more -- see the signature in
 * `writePyodideOutputs`.
 */
export async function refreshPyodideOutputs(tab, { create = false } = {}) {
  const path = tab?.currentFileHandle;
  if (typeof path !== "string" || !path) return null;
  const dir = path.replace(/[\\/][^\\/]*$/, "");
  try {
    const { exists } = await import("@tauri-apps/plugin-fs");
    // `create` is for the menu entry, which is asked for on purpose; a save is
    // not the moment to give a folder a `_build/pyodide` it never had.
    if (!create && !(await exists(`${dir}/${PYODIDE_BUILD_DIR}/${PYODIDE_MANIFEST}`))) return null;
    const root = (tab?.editorId && document.getElementById(tab.editorId)?.shadowRoot) || null;
    return await writePyodideOutputs(tab, dir, root);
  } catch (err) {
    // Never fatal: a save must happen whatever the outputs do.
    console.warn("[export] the cell outputs could not be refreshed:", err);
    return null;
  }
}
