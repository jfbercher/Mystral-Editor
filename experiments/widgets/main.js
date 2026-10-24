/**
 * The JavaScript half of the experiment.
 *
 * `HTMLManager` is the standard widget manager -- the same one thebe uses --
 * and it already carries the views for every control ipywidgets ships. What it
 * does not carry is a way to talk to a kernel, because it was written for
 * static pages. That is the one thing supplied here, and it is the whole
 * question: if a manager can be given a comm that reaches this page's own
 * Pyodide, then widgets do not require a kernel.
 */

import { HTMLManager } from "@jupyter-widgets/html-manager";
import "@jupyter-widgets/controls/css/widgets.css";

const statusEl = document.getElementById("status");
const logEl = document.getElementById("log");
const widgetEl = document.getElementById("widget");

const log = (...parts) => {
  logEl.textContent += parts.join(" ") + "\n";
  logEl.scrollTop = logEl.scrollHeight;
};
const status = (text, kind = "") => {
  statusEl.textContent = text;
  statusEl.className = kind;
};

/** Comms this page knows about, by id. */
const comms = new Map();

/**
 * One comm, as the widget manager expects to find it.
 *
 * The interface is small -- an id, a way to send, and two callbacks -- which
 * is the point: nothing here knows what a widget is.
 */
class PyComm {
  constructor(commId, targetName) {
    this.comm_id = commId;
    this.target_name = targetName;
    this._onMsg = null;
    this._onClose = null;
  }

  open() {
    return this.comm_id;
  }

  send(data, callbacks) {
    const json = JSON.stringify(data);
    const answer = deliverToPython(this.comm_id, json);
    log("js →", json.length > 120 ? json.slice(0, 120) + "…" : json, "·", answer);

    // The piece a comm alone does not provide, and the one thing this
    // experiment would not have found by reading.
    //
    // A widget model counts the messages it has in flight and refuses to send
    // another until the kernel reports itself idle, which a kernel does at the
    // end of every execution. Nothing here is a kernel, so that report never
    // came: the first change was sent, the counter stayed at one, and every
    // later change was queued for ever. The slider moved, Python did not.
    //
    // Deferred by a microtask on purpose: the model increments the counter
    // *after* this call returns, so an idle announced synchronously would be
    // counted before the message it acknowledges.
    queueMicrotask(() => {
      callbacks?.iopub?.status?.({ content: { execution_state: "idle" } });
    });

    return this.comm_id;
  }

  close() {
    comms.delete(this.comm_id);
    return this.comm_id;
  }

  on_msg(callback) {
    this._onMsg = callback;
  }

  on_close(callback) {
    this._onClose = callback;
  }
}

class PyodideManager extends HTMLManager {
  async _create_comm(targetName, modelId, data, metadata, buffers) {
    const comm = new PyComm(modelId ?? `comm-${Math.random().toString(36).slice(2)}`, targetName);
    comms.set(comm.comm_id, comm);
    return comm;
  }

  async _get_comm_info() {
    return {};
  }
}

const manager = new PyodideManager();
let deliverToPython = () => {};

// Said as early as anything can be said here. The page's own first line read
// "Loading Pyodide", which is also what the first step would have written --
// so a module that never ran and a Pyodide that never answered looked exactly
// alike. They no longer do.
status("Module loaded. Fetching Pyodide…");
log("main.js running");

/**
 * Pyodide by script tag rather than by ESM import.
 *
 * The same way the editor itself loads it, which is the point: this
 * experiment is about what the editor's Pyodide can do, so it should be the
 * editor's Pyodide, loaded the editor's way.
 */
function loadPyodideScript(base) {
  return new Promise((resolve, reject) => {
    if (globalThis.loadPyodide) return resolve(globalThis.loadPyodide);
    const el = document.createElement("script");
    el.src = `${base}pyodide.js`;
    el.onload = () => resolve(globalThis.loadPyodide);
    el.onerror = () => reject(new Error(`could not fetch ${el.src}`));
    document.head.appendChild(el);
  });
}

/** Every message leaving Python arrives here. */
function fromPython(msgType, contentJson, metadataJson) {
  const content = JSON.parse(contentJson);
  const metadata = JSON.parse(metadataJson);
  log("py →", msgType, content.comm_id ?? "");

  if (msgType === "comm_open") {
    const comm = new PyComm(content.comm_id, content.target_name);
    comms.set(comm.comm_id, comm);
    manager
      .handle_comm_open(comm, { content, metadata, buffers: [] })
      .catch((e) => log("handle_comm_open failed:", e.message));
    return;
  }

  const comm = comms.get(content.comm_id);
  if (!comm) return void log("  (no comm for that id)");
  if (msgType === "comm_msg") comm._onMsg?.({ content, metadata, buffers: [] });
  if (msgType === "comm_close") comm._onClose?.({ content, metadata, buffers: [] });
}

const PYODIDE_BASE = "https://cdn.jsdelivr.net/pyodide/v0.29.3/full/";

async function main() {
  const loadPyodide = await loadPyodideScript(PYODIDE_BASE);
  if (!loadPyodide) throw new Error("pyodide.js loaded but exposed no loadPyodide");
  status("Starting the interpreter…");
  const pyodide = await loadPyodide({ indexURL: PYODIDE_BASE });
  log("pyodide", pyodide.version);

  status("Installing ipywidgets…");
  await pyodide.loadPackage("micropip");
  const micropip = pyodide.pyimport("micropip");
  await micropip.install("ipywidgets");

  status("Wiring the comm…");
  const bridgeSource = await (await fetch(new URL("./bridge.py", import.meta.url))).text();
  pyodide.runPython(bridgeSource);
  const bridge = pyodide.globals;
  bridge.set("to_js", fromPython);
  deliverToPython = (commId, json) => bridge.get("deliver")(commId, json);

  status("Creating the widget…");
  // Python reports its own value, rather than being asked for it. Asking
  // from the change event reads it before the view has sent anything, so the
  // answer is always one move old -- a property of the measurement, not of
  // the channel.
  pyodide.globals.set("report", (text) => log(String(text)));
  const modelId = pyodide.runPython(`
from ipywidgets import IntSlider
slider = IntSlider(value=7, min=0, max=10, description="n")
slider.observe(lambda change: report(f"python: slider.value = {change['new']}"), names="value")
slider.model_id
`);
  log("model id:", modelId);

  const model = await manager.get_model(modelId);
  const view = await manager.create_view(model);
  widgetEl.appendChild(view.el);

  // The half that actually settles the question: a change made in the page
  // has to reach the Python object, not merely redraw the control.
  model.on("change:value", () => {
    log("js model: value =", model.get("value"));
  });

  document.getElementById("set3").onclick = () => {
    pyodide.runPython("slider.value = 3");
    log("python set slider.value = 3");
  };
  document.getElementById("read").onclick = () => {
    log("python slider.value =", pyodide.runPython("slider.value"));
  };
  document.getElementById("set3").disabled = false;
  document.getElementById("read").disabled = false;

  status("Ready. Drag the slider, then read the value back.", "good");
}

main().catch((err) => {
  console.error(err);
  status(`Failed: ${err.message}`, "bad");
  log(String(err.stack ?? err));
});
