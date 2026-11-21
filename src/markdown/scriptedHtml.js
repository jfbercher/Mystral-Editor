/**
 * HTML outputs that need their own scripts to draw: bokeh, plotly, folium,
 * altair.
 *
 * Such an output is a web page written by a library, not by the author of the
 * document, and this panel lives inside the editor: running its scripts in the
 * page would hand them the editor's privileges, Tauri's file API included, so
 * a document received from a third party could read and write on the reader's
 * machine through a single `display(HTML(...))`. They are therefore not
 * executed in the page but in an `<iframe sandbox="allow-scripts">` built from
 * `srcdoc`: no `allow-same-origin`, so the frame has an opaque origin and can
 * reach neither the editor's DOM, nor its storage, nor Tauri.
 *
 * An output without a script keeps the sanitised inline insertion it has
 * always had -- a pandas table has to stay selectable and copyable in the
 * document, which it would not be inside a frame.
 *
 * The frame cannot be measured from here (reading its document would need the
 * same origin we are refusing), so it measures itself and sends its height up.
 */

import { showToast } from "../utils/utils_ui.js";
import { openExternalUrl } from "../utils/local_utils/zoom.js";

/** Smallest and largest height we will take from a frame, in pixels. */
const MIN_HEIGHT = 60;
const MAX_HEIGHT = 6000;

/**
 * Does this HTML need a script to draw itself?
 *
 * Parsed rather than matched: `DOMParser` builds a document without running
 * anything, and a `<script>` written across several lines or carrying
 * attributes is found as reliably as a bare one. An event-handler attribute
 * counts too -- `<div onload=...>` is a script by another spelling.
 */
export function containsScript(html) {
  if (!html) return false;
  try {
    const doc = new DOMParser().parseFromString(String(html), "text/html");
    if (doc.querySelector("script")) return true;
    for (const el of doc.querySelectorAll("*")) {
      for (const attr of el.attributes) if (/^on/i.test(attr.name)) return true;
    }
    return false;
  } catch {
    // An unparsable string is not worth a frame of its own.
    return /<script[\s>]/i.test(String(html));
  }
}

/**
 * The frames currently on screen, so that a height message can be matched to
 * the one that sent it. `event.source` is the only identification an opaque
 * origin leaves us, and it is enough: a window is its own name.
 */
const frames = new Set();
let listening = false;

/** The section of the documentation that explains all this. */
const DOC_URL = "https://mystral-editor.readthedocs.io/en/latest/executable-content/#outputs-that-bring-their-own-javascript";

/** Which library a refused address belongs to, as far as we can tell. */
const LIBRARY_BY_PATH = [
  [/bokeh/i, "Bokeh"],
  [/plotly/i, "Plotly"],
  [/leaflet|folium/i, "Leaflet (folium)"],
  [/vega|altair/i, "Vega (altair)"],
  [/mathjax/i, "MathJax"],
  [/require/i, "RequireJS"],
];

function libraryOf(uri) {
  for (const [pattern, name] of LIBRARY_BY_PATH) if (pattern.test(uri)) return name;
  return null;
}

function hostOf(uri) {
  try {
    return new URL(uri).host;
  } catch {
    return String(uri).slice(0, 60);
  }
}

/**
 * Says out loud that the security policy refused a library.
 *
 * The console said it already, but only to whoever thought of opening it: what
 * the reader saw was a cell stuck on "Loading BokehJS ..." with no explanation
 * anywhere. The refusals of one frame are gathered for a moment first, since a
 * single plot asks for five files and five toasts would be five times the same
 * news.
 */
const pending = new Map();

function reportBlocked(frame, uri) {
  let entry = pending.get(frame);
  if (!entry) {
    entry = { uris: new Set(), timer: null };
    pending.set(frame, entry);
  }
  entry.uris.add(uri);
  clearTimeout(entry.timer);
  entry.timer = setTimeout(() => {
    pending.delete(frame);
    const uris = [...entry.uris];
    const hosts = [...new Set(uris.map(hostOf))];
    const library = uris.map(libraryOf).find(Boolean);
    const what = library ? `${library} could not be loaded` : "A library could not be loaded";
    showToast(
      `${what}: the editor's security policy does not allow scripts from ${hosts.join(", ")}. ` +
        `An output that carries its own code works instead -- for Bokeh, HTML(file_html(p, INLINE)) -- ` +
        `and it also works offline. See "Outputs that bring their own JavaScript" in the documentation.`,
      "warning",
      0,
      { label: "Documentation", onClick: () => openExternalUrl(DOC_URL) },
    );
  }, 800);
}

function listenForFrames() {
  if (listening) return;
  listening = true;
  window.addEventListener("message", (ev) => {
    const height = ev.data?.mystralFrameHeight;
    const blocked = ev.data?.mystralFrameBlocked;
    if (typeof height !== "number" && typeof blocked !== "string") return;
    for (const frame of [...frames]) {
      if (!frame.isConnected) {
        frames.delete(frame);
        continue;
      }
      if (frame.contentWindow !== ev.source) continue;
      if (typeof blocked === "string") {
        reportBlocked(frame, blocked);
        return;
      }
      if (!Number.isFinite(height)) return;
      // Clamped: the number comes from a sandboxed document, and the only harm
      // it could do here is to the layout of the page around it.
      frame.style.height = `${Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, Math.ceil(height)))}px`;
      return;
    }
  });
}

/**
 * The script every frame carries, which reports its own height.
 *
 * Three ways of noticing, because a plot arrives by three different routes: on
 * `load` for what is drawn at once, through a `ResizeObserver` for what grows
 * afterwards, and on a few timers for a library fetched from a CDN that draws
 * when it lands, long after `load`.
 */
const HEIGHT_REPORTER = `
<script>
(function () {
  var last = -1;
  function send() {
    var body = document.body;
    var root = document.documentElement;
    var h = Math.max(
      body ? body.scrollHeight : 0,
      body ? body.offsetHeight : 0,
      root ? root.scrollHeight : 0,
      root ? root.offsetHeight : 0
    );
    if (h === last) return;
    last = h;
    parent.postMessage({ mystralFrameHeight: h }, "*");
  }
  window.addEventListener("load", send);
  document.addEventListener("DOMContentLoaded", send);
  if (window.ResizeObserver) {
    try {
      new ResizeObserver(send).observe(document.documentElement);
      if (document.body) new ResizeObserver(send).observe(document.body);
    } catch (e) {}
  }
  [100, 400, 1000, 2500, 5000].forEach(function (d) { setTimeout(send, d); });
})();
<\/script>`;

/**
 * The script every frame opens with, which reports what the security policy
 * refuses.
 *
 * It has to come first, before the library's own code, or the first refusal
 * would happen before anyone is listening. Two ways of noticing: the policy's
 * own `securitypolicyviolation` event, which names the address and the
 * directive, and the `error` event of a `<script>` whose source never arrived,
 * caught in the capture phase since it does not bubble.
 */
const BLOCK_REPORTER = `
<script>
(function () {
  function tell(uri) {
    if (!uri) return;
    try { parent.postMessage({ mystralFrameBlocked: String(uri) }, "*"); } catch (e) {}
  }
  document.addEventListener("securitypolicyviolation", function (ev) {
    if (/script/.test(ev.violatedDirective || "")) tell(ev.blockedURI);
  });
  window.addEventListener("error", function (ev) {
    var t = ev.target;
    if (t && t.tagName === "SCRIPT" && t.src) tell(t.src);
  }, true);
})();
<\/script>`;

/**
 * The document a frame shows: every script-bearing output of the cell, in the
 * order the cell produced them.
 *
 * One frame per cell rather than one per output, so that a cell calling
 * `output_notebook()` and then `show(p)` still works: the loader and the plot
 * it belongs to have to meet in the same document. Two cells do not share
 * anything, which is the price of the isolation and is worth saying in the
 * documentation.
 */
function buildSrcdoc(htmlChunks) {
  return [
    "<!doctype html><html><head><meta charset=\"utf-8\">",
    BLOCK_REPORTER,
    "<style>html,body{margin:0;padding:0;background:transparent;",
    "font-family:system-ui,-apple-system,sans-serif;font-size:14px}",
    "img,canvas,svg{max-width:100%}</style></head><body>",
    htmlChunks.join("\n"),
    HEIGHT_REPORTER,
    "</body></html>",
  ].join("");
}

/**
 * Puts the script-bearing outputs of one cell into a sandboxed frame, inside
 * `slot`.
 */
export function mountScriptedHtml(slot, htmlChunks) {
  if (!slot || !htmlChunks?.length) return null;
  listenForFrames();

  const frame = document.createElement("iframe");
  // Scripts, and nothing else: no same origin, no forms, no top-level
  // navigation, no popups. Set through `setAttribute` because the property is
  // a read-only token list.
  frame.setAttribute("sandbox", "allow-scripts");
  frame.setAttribute("scrolling", "no");
  frame.setAttribute("title", "cell output");
  frame.className = "pyodide-html-frame";
  frame.srcdoc = buildSrcdoc(htmlChunks);

  slot.appendChild(frame);
  frames.add(frame);
  return frame;
}
