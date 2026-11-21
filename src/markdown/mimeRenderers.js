/**
 * What to do with a MIME bundle.
 *
 * Jupyter's display protocol is generic -- an object offers several
 * representations of itself and the front end picks the one it can show --
 * but we are not a notebook front end, and libraries negotiate with us as if
 * we were. Plotly sends its figure as JSON because it assumes the page
 * carries plotly.js; bokeh sends a loader because it assumes a document it
 * may fill. Each one of them bargains with an imaginary interlocutor, and it
 * is that bargaining, not the drawing, that differs from one library to the
 * next.
 *
 * So the choice is made in one table rather than in three chains of `if`:
 * `jupyterRuntime` for a cell's outputs, `widgetManager` for what an `Output`
 * widget holds, and the HTML a Pyodide value renders of itself. Adding the
 * next exotic package should be an entry here, not an investigation.
 *
 * Each entry answers a whole bundle rather than a single type, because a
 * representation can be spread over two of them -- bokeh's placeholder in
 * `text/html` and the code that fills it in `application/javascript` are one
 * output and have to travel together. The entries are tried in order, which
 * is the priority: a picture before marked-up text, marked-up text before
 * plain text.
 *
 * A fragment is data, not DOM. The callers draw it, since a cell's output
 * area and a widget's are not laid out the same way.
 *
 * Not covered here: `fromMimes()` in jupyterRuntime, which serves the `{eval}`
 * role. It answers a different question -- what to put inside a sentence --
 * and inlining a frame in a paragraph is not something we want.
 */

import { containsScript } from "./scriptedHtml.js";

/**
 * An image from a MIME bundle, as a data URL.
 *
 * Complete, not the bare base64: the drawing does `img.src = ...`, and a
 * string that is not a URL is taken for a relative address -- the browser then
 * asks the server for an address a hundred thousand characters long and gets a
 * `431 Request Header Fields Too Large`. That was what the image was worth.
 */
function imageUrl(data) {
  if (data["image/png"]) return `data:image/png;base64,${data["image/png"]}`;
  if (data["image/jpeg"]) return `data:image/jpeg;base64,${data["image/jpeg"]}`;
  if (data["image/svg+xml"]) return `data:image/svg+xml;utf8,${encodeURIComponent(data["image/svg+xml"])}`;
  return null;
}

/**
 * The HTML of a bundle, with its script if it has one.
 *
 * A bundle may carry `text/html` and `application/javascript` together, and
 * they are then one output: bokeh sends a placeholder and the code that draws
 * into it, and taking the HTML alone is how a cell stayed on "Loading
 * BokehJS ..." for ever.
 */
function joinedHtml(data) {
  const html = data["text/html"];
  const js = data["application/javascript"] ?? data["text/javascript"];
  if (!html && !js) return null;
  return String(html ?? "") + (js ? `\n<script>${js}<\/script>` : "");
}

/**
 * The table. Order is priority; `match` returns a fragment or null.
 *
 * `kind` tells the caller what to draw: a widget view to mount, an image, a
 * piece of HTML, some markdown, plain text, or a line of explanation. `frame`
 * on an HTML fragment says it must be drawn inside the sandboxed frame rather
 * than in the page -- see scriptedHtml.js.
 */
export const MIME_RENDERERS = [
  {
    id: "widget",
    match: (data) => {
      const view = data["application/vnd.jupyter.widget-view+json"];
      return view?.model_id ? { kind: "widget", modelId: view.model_id } : null;
    },
  },
  {
    id: "image",
    match: (data) => {
      const src = imageUrl(data);
      return src ? { kind: "image", src } : null;
    },
  },
  {
    id: "html",
    match: (data) => {
      const html = joinedHtml(data);
      // Whether a frame is needed cannot be declared for `text/html` in
      // general: it depends on what the library wrote. A DataFrame has to stay
      // in the page, where it is selectable; a plot that draws itself cannot.
      return html === null ? null : { kind: "html", html, frame: containsScript(html) };
    },
  },
  {
    id: "markdown",
    match: (data) => {
      const text = data["text/markdown"];
      // `display(Markdown(...))` sends this, and its plain-text alternative is
      // the object's repr -- which is how `<IPython.core.display.Markdown
      // object>` used to be what a reader saw.
      return text == null ? null : { kind: "markdown", text: String(text) };
    },
  },
];

/**
 * The fragment to draw for one bundle, or null when there is nothing to draw.
 *
 * `textFallback` decides what an unknown bundle becomes. Where plain text is
 * an answer -- the result of an expression, an item inside an `Output` -- it
 * is used. Where it is not, the reader is told which type arrived instead,
 * because a cell that shows nothing without a word is the worst of outputs:
 * plotly's own default renderer under a kernel sends `vnd.plotly.v1+json` and
 * used to produce exactly that silence.
 */
export function renderBundle(data, { textFallback = false } = {}) {
  if (!data) return null;
  for (const renderer of MIME_RENDERERS) {
    const fragment = renderer.match(data);
    if (fragment) return { id: renderer.id, ...fragment };
  }
  if (textFallback && data["text/plain"] != null) {
    return { id: "text", kind: "text", text: String(data["text/plain"]) };
  }
  const types = Object.keys(data).filter((t) => t !== "text/plain");
  if (!types.length) return null;
  // Plotly's case is worth more than its name: one line of Python turns the
  // JSON it sent into HTML we can draw.
  const plotly = types.some((t) => t.startsWith("application/vnd.plotly"));
  return {
    id: "unknown",
    kind: "note",
    text:
      `Output not displayed; the kernel sent it as ${types.join(", ")}.` +
      (plotly ? ` Add pio.renderers.default = "notebook_connected" to draw it here.` : ""),
  };
}
