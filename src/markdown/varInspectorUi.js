/**
 * varInspectorUi.js — the "Vars" window of a code-cell.
 *
 * Shows what the Python namespace currently holds: one row per user variable,
 * with its type, memory footprint, shape and a short repr, and a button to
 * remove it. It is a snapshot taken when it opens: nothing can change the
 * namespace while the window is up, so there is no refresh button -- the list
 * is re-read after each deletion and when the filter on kinds changes.
 *
 * Owes its column set and its size heuristics to the Jupyter varInspector
 * nbextension (ipython-contrib), whose approach of asking arrays and frames
 * for their own footprint rather than trusting sys.getsizeof is reused here.
 */

import { inspectNamespace, deleteVariables } from "./pyodideRunner";

const OVERLAY_ID = "mystral-vars-overlay";

const humanSize = (n) => {
  if (n === null || n === undefined || n < 0) return "?";
  const units = ["B", "kB", "MB", "GB"];
  let value = n;
  for (const unit of units) {
    if (value < 1024 || unit === "GB") {
      return unit === "B" ? `${Math.round(value)} B` : `${value.toFixed(1)} ${unit}`;
    }
    value /= 1024;
  }
  return `${n}`;
};

const escapeHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

/** Open (or re-open) the variable window. */
export async function showVarInspector() {
  document.getElementById(OVERLAY_ID)?.remove();

  const overlay = document.createElement("div");
  overlay.id = OVERLAY_ID;
  overlay.style.cssText =
    "position:fixed; inset:0; background:rgba(0,0,0,.4); display:flex;" +
    "align-items:center; justify-content:center; z-index:9999;";
  overlay.addEventListener("click", (ev) => { if (ev.target === overlay) close(); });

  const box = document.createElement("div");
  box.style.cssText =
    "background:var(--pyodide-cell-bg, #fff); color:var(--pyodide-cell-fg, #1f2328);" +
    "border-radius:8px; padding:18px 20px; width:min(860px, 92vw); max-height:80vh;" +
    "display:flex; flex-direction:column; gap:10px; font-family:sans-serif;" +
    "box-shadow:0 4px 20px rgba(0,0,0,.25);";
  box.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px;">
      <h2 style="margin:0; font-size:1.05rem; flex:1;">Variables</h2>
      <input class="vars-filter" type="search" placeholder="Filter…"
             style="padding:4px 8px; min-width:140px;" />
      <label style="display:flex; align-items:center; gap:4px; font-size:.85rem; white-space:nowrap;">
        <input class="vars-all" type="checkbox" /> modules &amp; functions
      </label>
      <button class="vars-close" style="padding:4px 10px; cursor:pointer;">Close</button>
    </div>
    <div class="vars-body" style="overflow:auto; font-size:.86rem;">Reading the namespace…</div>
    <div class="vars-total" style="font-size:.8rem; opacity:.75;"></div>
  `;
  overlay.appendChild(box);
  document.body.appendChild(overlay);

  const onKey = (ev) => { if (ev.key === "Escape") close(); };
  function close() {
    document.removeEventListener("keydown", onKey);
    overlay.remove();
  }
  document.addEventListener("keydown", onKey);

  const body = box.querySelector(".vars-body");
  const total = box.querySelector(".vars-total");
  const filter = box.querySelector(".vars-filter");
  const allBox = box.querySelector(".vars-all");
  let rows = [];
  let sortKey = "name";
  let sortAsc = true;

  const render = () => {
    const needle = filter.value.trim().toLowerCase();
    const shown = rows
      .filter((r) => !needle || r.name.toLowerCase().includes(needle) || r.type.toLowerCase().includes(needle))
      .sort((a, b) => {
        const [x, y] = [a[sortKey], b[sortKey]];
        const cmp = typeof x === "number" && typeof y === "number"
          ? x - y
          : String(x).localeCompare(String(y), undefined, { sensitivity: "base" });
        return sortAsc ? cmp : -cmp;
      });

    if (!rows.length) {
      body.innerHTML = `<p style="opacity:.7;">The namespace is empty — run a cell first.</p>`;
      total.textContent = "";
      return;
    }
    const arrow = (k) => (sortKey === k ? (sortAsc ? " ▲" : " ▼") : "");
    const head = `<th style="width:1.6em;"></th>` + ["name", "type", "size", "shape", "preview"]
      .map((k) => `<th data-key="${k}" style="text-align:left; cursor:pointer; padding:4px 8px;
                     border-bottom:1px solid currentColor; white-space:nowrap;">${
                     k === "preview" ? "Value" : k[0].toUpperCase() + k.slice(1)}${arrow(k)}</th>`)
      .join("");
    const cells = shown
      .map((r) => `<tr>
        <td style="padding:3px 2px;"><button class="vars-del" data-name="${escapeHtml(r.name)}"
            data-module="${r.type === "module" ? "1" : ""}"
            title="${r.type === "module"
              ? "Unload this module: removes the name and drops it from sys.modules (memory is freed only if nothing else references it)"
              : "Delete this variable"}"
            style="border:none; background:none; cursor:pointer; opacity:.55; font-size:1rem; line-height:1;">×</button></td>
        <td style="padding:3px 8px; font-family:monospace;">${escapeHtml(r.name)}</td>
        <td style="padding:3px 8px; opacity:.85;">${escapeHtml(r.type)}</td>
        <td style="padding:3px 8px; text-align:right; white-space:nowrap;">${humanSize(r.size)}</td>
        <td style="padding:3px 8px; white-space:nowrap;">${escapeHtml(r.shape || "")}</td>
        <td style="padding:3px 8px; font-family:monospace; white-space:pre; overflow:hidden;
                   text-overflow:ellipsis; max-width:34ch;" title="${escapeHtml(r.preview)}">${escapeHtml(r.preview)}</td>
      </tr>`)
      .join("");
    body.innerHTML = `<table style="border-collapse:collapse; width:100%;">
        <thead><tr>${head}</tr></thead><tbody>${cells}</tbody></table>
      ${shown.length === rows.length ? "" : `<p style="opacity:.7; margin:.6em 0 0;">${shown.length} of ${rows.length} shown.</p>`}`;

    const bytes = shown.reduce((sum, r) => sum + (r.size > 0 ? r.size : 0), 0);
    const unknown = shown.filter((r) => !(r.size > 0)).length;
    total.textContent =
      `${shown.length} variable${shown.length === 1 ? "" : "s"}, ` +
      `about ${humanSize(bytes)} in total` +
      (unknown ? ` (${unknown} of unknown size)` : "") +
      ". Containers report their own footprint, not that of what they hold, and a shared object is counted once per name.";

    body.querySelectorAll(".vars-del").forEach((btn) =>
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        await deleteVariables([btn.dataset.name], { unloadModules: Boolean(btn.dataset.module) });
        await load();
      }));

    body.querySelectorAll("th[data-key]").forEach((th) =>
      th.addEventListener("click", () => {
        const key = th.dataset.key;
        if (key === sortKey) sortAsc = !sortAsc;
        else { sortKey = key; sortAsc = true; }
        render();
      }));
  };

  const load = async () => {
    const list = await inspectNamespace(allBox.checked);
    if (list === null) {
      body.innerHTML = `<p style="opacity:.7;">Python has not started yet — run a cell first.</p>`;
      total.textContent = "";
      rows = [];
      return;
    }
    rows = list;
    render();
  };

  box.querySelector(".vars-close").addEventListener("click", close);
  allBox.addEventListener("change", load);
  filter.addEventListener("input", render);
  filter.focus();

  await load();
}
