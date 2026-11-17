/**
 * Les ipywidgets, côté navigateur.
 *
 * Le noyau tient les modèles ; ce module leur donne un répondant ici. C'est la
 * suite directe du routage des comms (`jupyterRuntime.js`) : les messages
 * arrivaient et n'allaient nulle part, ils vont désormais à un gestionnaire.
 *
 * ## Pourquoi `ManagerBase` et non `html-manager`
 *
 * `@jupyter-widgets/html-manager` sert à rendre un état **figé** -- un carnet
 * exporté -- et, pour un noyau vivant, attend une connexion façon
 * `@jupyterlab/services`, donc sa propre WebSocket. La nôtre passe par Rust,
 * la politique de sécurité de la webview refusant le bouclage local ; et il
 * tire `@jupyterlab/outputarea`, `rendermime` et deux copies de `controls`
 * pour la compatibilité v7. Sous-classer `ManagerBase` demande trois méthodes
 * et évite tout cela.
 *
 * ## Les vues
 *
 * `mountWidget` fabrique la vue d'un modèle et la pose dans la sortie d'une
 * cellule, avec la feuille de style de `controls` adoptée sur la racine qui
 * la porte -- une feuille chargée par la page n'entre pas dans un shadow DOM.
 *
 * Une limite à connaître, écrite ici pour qu'on ne la redécouvre pas : les
 * **tampons binaires** d'un message de widget (une image dans un modèle, par
 * exemple) voyagent en trames binaires que notre relais, qui ne passe que du
 * texte, laisse tomber.
 */
import { onComm, onCommOutput, claimOutputParent, releaseOutputParent, isOutputParent, sendCommMessage, listComms, wdbg } from "./jupyterRuntime.js";
import DOMPurify from "dompurify";
import { SHARED_SPACE } from "./cellRuntime.js";

/** La cible que les ipywidgets se donnent, et la seule qui nous concerne. */
const WIDGET_TARGET = "jupyter.widget";

/**
 * Un comm vu par ipywidgets.
 *
 * L'interface qu'il attend (`IClassicComm`) est celle du vieux client Jupyter :
 * trois verbes pour écrire, deux pour écouter. Tout passe par `sendComm`, donc
 * par le relais Rust et la même WebSocket que les cellules.
 */
class KernelComm {
  constructor(space, commId, targetName = WIDGET_TARGET) {
    this.space = space;
    this.comm_id = commId;
    this.target_name = targetName;
    this._onMsg = null;
    this._onClose = null;
  }

  _write(msgType, content, callbacks) {
    if (typeof window !== "undefined") window.__commSends = (window.__commSends ?? 0) + 1;
    try {
      return sendCommMessage(this.space, msgType, { comm_id: this.comm_id, ...content }, callbacks);
    } catch (err) {
      console.warn(`[widgets] ${msgType} sur ${this.comm_id} :`, err);
      return "";
    }
  }

  open(data, callbacks, metadata, _buffers) {
    return this._write("comm_open", { target_name: this.target_name, data: data ?? {}, metadata: metadata ?? {} }, callbacks);
  }

  send(data, callbacks, metadata, _buffers) {
    return this._write("comm_msg", { data: data ?? {}, metadata: metadata ?? {} }, callbacks);
  }

  close(data, callbacks, metadata, _buffers) {
    return this._write("comm_close", { data: data ?? {}, metadata: metadata ?? {} }, callbacks);
  }

  on_msg(callback) {
    this._onMsg = callback;
  }

  on_close(callback) {
    this._onClose = callback;
  }

  /** Appelé par le routage, avec le message tel que le noyau l'a envoyé. */
  deliver(msg) {
    if (msg.msg_type === "comm_close") this._onClose?.(msg);
    else this._onMsg?.(msg);
  }
}

/**
 * La feuille de style des widgets, adoptée une fois par racine.
 *
 * Les vues vivent dans le shadow DOM de l'éditeur, où une feuille chargée par
 * la page n'entre pas : il faut l'adopter sur la racine qui les porte. Une
 * seule fois par racine, et en mémoire plutôt qu'en balise, comme le reste du
 * style de cet éditeur.
 */
const styledRoots = new WeakSet();

async function adoptWidgetStyles(root) {
  if (!root || typeof root.adoptedStyleSheets === "undefined" || styledRoots.has(root)) return;
  styledRoots.add(root);
  try {
    // `widgets.built.css` et non `widgets.css` : la seconde ne fait que deux
    // `@import`, que l'import en ligne ne suit pas -- d'où un curseur sans
    // rail, le style de nouislider manquant à l'appel. La première est la
    // feuille déjà assemblée, celle que distribue html-manager.
    const { default: css } = await import("@jupyter-widgets/controls/css/widgets.built.css?inline");
    // `:root` ne désigne pas une racine d'ombre : à l'intérieur, il ne
    // correspond à rien, et toutes les variables `--jp-*` que les widgets
    // lisent seraient restées indéfinies. `:host` est son équivalent ici.
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(String(css ?? "").replace(/:root\b/g, ":host, :root"));
    // En tête, et non en queue : une feuille tierce doit passer **sous** les
    // nôtres, sinon elle gagne à égalité de spécificité et le thème de
    // l'éditeur ne peut plus reprendre la main -- c'est ce qui laissait le
    // nombre d'un curseur noir sur noir en thème sombre.
    root.adoptedStyleSheets = [sheet, ...root.adoptedStyleSheets];
  } catch (err) {
    // Sans style, un widget s'affiche quand même, en moins présentable. Le
    // dire une fois vaut mieux que de refuser de l'afficher.
    console.warn("[widgets] feuille de style non adoptée :", err);
  }
}

/**
 * Typeset the maths a widget shows, with the editor's own renderer.
 *
 * ipywidgets calls MathJax 2 and does nothing when it is absent, so an
 * `HTMLMath` or a `Label` showed its `$E=mc^2$` as plain text. Rather than
 * bring MathJax into a page that already renders maths with KaTeX -- and
 * rather than install a global `MathJax` shim that other code might mistake
 * for the real thing -- the view's own element is typeset here, and again
 * whenever its content changes, which is how a widget updates.
 *
 * The observer is disconnected while rendering: KaTeX rewrites the very DOM
 * it watches, and listening to oneself is a loop.
 */
let renderMath = null;

async function typesetWidget(el) {
  if (!el) return;
  try {
    renderMath ??= (await import("katex/dist/contrib/auto-render.mjs")).default;
  } catch (err) {
    return console.warn("[widgets] maths not typeset:", err);
  }
  const options = {
    delimiters: [
      { left: "$$", right: "$$", display: true },
      { left: "\\[", right: "\\]", display: true },
      { left: "$", right: "$", display: false },
      { left: "\\(", right: "\\)", display: false },
    ],
    throwOnError: false,
  };
  const observer = new MutationObserver(() => run());
  const run = () => {
    observer.disconnect();
    try {
      renderMath(el, options);
    } catch (err) {
      console.warn("[widgets] maths not typeset:", err);
    }
    observer.observe(el, { childList: true, subtree: true, characterData: true });
  };
  run();
}

/**
 * Monter la vue d'un modèle dans un élément.
 *
 * Le gestionnaire fabrique la vue, Lumino la pose. `Widget.attach` veut un
 * hôte déjà dans le document, ce qui est le cas d'une sortie de cellule au
 * moment où on l'appelle ; en dernier recours on insère l'élément de la vue
 * directement, ce qui suffit aux widgets qui n'ont pas de panneau.
 */
export async function mountWidget(space, modelId, host) {
  const manager = await widgetManagerFor(space);
  const model = await manager.get_model(modelId);
  if (!model) throw new Error(`modèle inconnu : ${modelId}`);
  registerHosts(model, host);
  wdbg("montage", String(modelId).slice(0, 8), model.get?.("_model_name"));
  await adoptWidgetStyles(host.getRootNode?.());
  const view = await manager.create_view(model);
  const panel = view.luminoWidget ?? view.pWidget ?? null;
  if (panel) {
    const { Widget } = await import("@lumino/widgets");
    Widget.attach(panel, host);
  } else {
    host.appendChild(view.el);
  }
  typesetWidget(view.el);
  return view;
}

/**
 * One output item, drawn the way a cell draws its own.
 *
 * Shared by the `Output` view and by the fallback below, so that what a
 * callback prints looks the same wherever it ends up. The shapes are
 * notebook's: a stream, a MIME bundle, an error.
 */
/** Markdown, rendered by the same library the preview uses. */
let markdownIt = null;

async function renderMarkdownInto(el, text) {
  try {
    markdownIt ??= new (await import("markdown-it")).default({ html: true, linkify: true });
    el.innerHTML = DOMPurify.sanitize(markdownIt.render(String(text ?? "")));
  } catch (err) {
    // Rendering is a convenience; the text itself is the content, and showing
    // it raw beats showing nothing.
    el.textContent = String(text ?? "");
    console.warn("[widgets] markdown not rendered:", err);
  }
}

function renderOutputItem(container, out, space = SHARED_SPACE) {
  const kind = out?.output_type;
  if (kind === "stream") {
    const pre = document.createElement("pre");
    pre.className = out.name === "stderr" ? "pyodide-stderr" : "pyodide-stdout";
    pre.textContent = Array.isArray(out.text) ? out.text.join("") : (out.text ?? "");
    container.appendChild(pre);
    return;
  }
  if (kind === "error") {
    const pre = document.createElement("pre");
    pre.className = "pyodide-stderr";
    pre.textContent = (out.traceback ?? []).join("\n") || `${out.ename}: ${out.evalue}`;
    container.appendChild(pre);
    return;
  }
  if (!out?.data) return;
  // A widget displayed inside an `Output` -- a quiz showing its score as an
  // `HTML` widget, a form rebuilding itself. Its bundle carries a view and a
  // `text/plain` repr; falling through to the latter is what printed
  // `HTML(value=...)` where the widget belonged.
  const view = out.data["application/vnd.jupyter.widget-view+json"];
  if (view?.model_id) {
    const sub = document.createElement("div");
    sub.className = "pyodide-widget";
    container.appendChild(sub);
    mountWidget(space, view.model_id, sub).catch((err) => {
      sub.className = "pyodide-widget-note";
      sub.textContent = `ipywidget (${String(view.model_id).slice(0, 8)}…) — ${err?.message ?? err}`;
    });
    return;
  }
  const png = out.data["image/png"];
  const html = out.data["text/html"];
  const markdown = out.data["text/markdown"];
  if (png) {
    const img = document.createElement("img");
    img.src = `data:image/png;base64,${png}`;
    img.className = "pyodide-figure";
    container.appendChild(img);
  } else if (html) {
    const block = document.createElement("div");
    block.className = "pyodide-html";
    block.innerHTML = DOMPurify.sanitize(html);
    container.appendChild(block);
  } else if (markdown) {
    // `display(Markdown(...))` sends `text/markdown` and, as its plain-text
    // alternative, the object's repr -- which is how
    // `<IPython.core.display.Markdown object>` ended up on screen.
    const block = document.createElement("div");
    block.className = "pyodide-html";
    container.appendChild(block);
    renderMarkdownInto(block, markdown);
  } else {
    const pre = document.createElement("pre");
    pre.className = "pyodide-stdout";
    pre.textContent = String(out.data["text/plain"] ?? "");
    container.appendChild(pre);
  }
}

/**
 * What an output is, as far as redrawing is concerned.
 *
 * Two renders whose items have the same kinds in the same order can be
 * updated in place instead of being thrown away and rebuilt -- which is what
 * an animated `interact` does twenty times a second.
 */
function kindOfOutput(out) {
  const kind = out?.output_type;
  if (kind === "stream") return `stream:${out.name || "stdout"}`;
  if (kind === "error") return "error";
  const data = out?.data ?? {};
  const view = data["application/vnd.jupyter.widget-view+json"];
  if (view?.model_id) return `widget:${view.model_id}`;
  if (data["image/png"]) return "png";
  if (data["text/html"]) return "html";
  if (data["text/markdown"]) return "markdown";
  return "text";
}

/**
 * Update one already-drawn output in place.
 *
 * The point is the image: replacing the node makes the browser drop the old
 * one at once and give the new one no height until it has decoded, so the
 * text below jumps up and comes back down -- the flicker of an animation.
 * Setting `src` on the node that is already there keeps the old frame until
 * the new one is ready. A widget is left strictly alone: its view is mounted
 * and alive, and rebuilding it would be a far worse flicker.
 */
function patchOutputItem(node, out, kind) {
  if (kind.startsWith("widget:")) return true;
  if (kind === "png") {
    node.src = `data:image/png;base64,${out.data["image/png"]}`;
    return true;
  }
  if (kind === "html") {
    node.innerHTML = DOMPurify.sanitize(out.data["text/html"]);
    return true;
  }
  if (kind === "markdown") {
    renderMarkdownInto(node, out.data["text/markdown"]);
    return true;
  }
  if (kind === "error") {
    node.textContent = (out.traceback ?? []).join("\n") || `${out.ename}: ${out.evalue}`;
    return true;
  }
  if (kind.startsWith("stream:")) {
    node.textContent = Array.isArray(out.text) ? out.text.join("") : (out.text ?? "");
    return true;
  }
  if (kind === "text") {
    node.textContent = String(out.data?.["text/plain"] ?? "");
    return true;
  }
  return false;
}

/** An iopub message, in the shape a notebook stores its outputs. */
function toOutputItem(msg) {
  const c = msg.content ?? {};
  switch (msg.msg_type) {
    case "stream":
      return { output_type: "stream", name: c.name, text: c.text };
    case "display_data":
      return { output_type: "display_data", data: c.data, metadata: c.metadata };
    case "execute_result":
      return { output_type: "execute_result", data: c.data, metadata: c.metadata };
    case "error":
      return { output_type: "error", ename: c.ename, evalue: c.evalue, traceback: c.traceback };
    default:
      return null;
  }
}

/** Where each mounted view lives, so an unclaimed output has somewhere to go. */
const hosts = new Map();

/**
 * Map a whole widget tree to its host, not just its root.
 *
 * The message comes from the widget the user touched -- a button inside a
 * `VBox` -- while what was mounted is the box. Keyed by the root alone, the
 * lookup would miss every nested control, which is to say nearly all of them.
 * A box exposes its `children` as models, so the tree is walkable; `seen`
 * guards the cycle a layout can make.
 */
function registerHosts(model, host, seen = new Set()) {
  const id = model?.model_id;
  if (!id || seen.has(id)) return;
  seen.add(id);
  hosts.set(id, host);
  for (const child of model.get?.("children") ?? []) registerHosts(child, host, seen);
}

/** Un gestionnaire par espace de noms, comme les noyaux eux-mêmes. */
const managers = new Map();

export function widgetManagerFor(space = SHARED_SPACE) {
  if (managers.has(space)) return managers.get(space);

  const ready = (async () => {
    // Importés à la demande : ces paquets pèsent, et un document qui n'a pas
    // de widget n'a pas à les charger.
    const [base, baseManager, controls] = await Promise.all([
      import("@jupyter-widgets/base"),
      import("@jupyter-widgets/base-manager"),
      import("@jupyter-widgets/controls"),
    ]);

    const comms = new Map();
    /** `msg_id` -> the `Output` model capturing under it. */
    const outputTargets = new Map();
    /** Models owing a clear, to be done when their next output arrives. */
    const deferredClear = new WeakSet();
    /**
     * Outputs that arrived before their model existed.
     *
     * The claim is registered the moment the kernel announces it, which is
     * what makes it reliable; building the model behind it is a promise, and
     * on the very first widget of a session it is still a promise when the
     * first outputs land. Held here by parent, and handed over when the model
     * finally claims that parent -- which is why a first `Output` was empty
     * while every one after it worked.
     */
    const earlyOutputs = new Map();

    class MystralWidgetManager extends baseManager.ManagerBase {
      /**
       * Quelle classe pour quel module. Les deux que nous embarquons, et un
       * refus clair pour le reste : un widget tiers -- `ipyleaflet`, `bqplot`
       * -- ne s'affichera pas, et il vaut mieux le dire que rendre une boîte
       * vide.
       */
      loadClass(className, moduleName) {
        // `Output` : rendu par nous plutôt qu'emprunté à JupyterLab. Un
        // `Output()` ne transporte que ses sorties dans son état -- la même
        // forme que celles d'un carnet --, et nous savons déjà les afficher :
        // du texte, du HTML, des images. Reprendre `@jupyter-widgets/output`
        // aurait fait entrer `@jupyterlab/outputarea` et `rendermime`, soit
        // précisément ce que sous-classer `ManagerBase` permettait d'éviter,
        // pour un résultat que l'utilisateur ne distinguerait pas.
        if (moduleName === "@jupyter-widgets/output") {
          if (className === "OutputModel") return Promise.resolve(OutputModel);
          if (className === "OutputView") return Promise.resolve(OutputView);
        }
        const mod = moduleName === "@jupyter-widgets/base" ? base : moduleName === "@jupyter-widgets/controls" ? controls : null;
        if (!mod) {
          // `@jupyter-widgets/output` est le cas qu'on rencontre : un
          // `Output()` est un widget dont le contenu est une aire de sortie
          // de JupyterLab, donc `@jupyterlab/outputarea` et `rendermime` --
          // précisément ce que sous-classer `ManagerBase` permettait
          // d'éviter. Le refus est net, et le message le dit.
          const why =
            moduleName === "@jupyter-widgets/output"
              ? "les widgets Output demandent l'aire de sortie de JupyterLab, non embarquée ici"
              : `module de widgets non embarqué : ${moduleName}`;
          return Promise.reject(new Error(why));
        }
        if (!mod[className]) return Promise.reject(new Error(`classe inconnue : ${className} dans ${moduleName}`));
        return Promise.resolve(mod[className]);
      }

      /** Un comm ouvert depuis ici, quand c'est le navigateur qui crée le modèle. */
      async _create_comm(targetName, modelId, data, metadata, buffers) {
        const comm = new KernelComm(space, modelId ?? crypto.randomUUID(), targetName);
        comms.set(comm.comm_id, comm);
        if (data !== undefined) comm.open(data, undefined, metadata, buffers);
        return comm;
      }

      /** Ce qui est ouvert, dans la forme que le gestionnaire attend. */
      async _get_comm_info() {
        const out = {};
        for (const entry of listComms()) {
          if (entry.space === space && entry.target === WIDGET_TARGET) out[entry.id] = { target_name: entry.target };
        }
        return out;
      }
    }

    /**
     * Le modèle d'un `Output` : rien de plus qu'un `DOMWidgetModel` dont
     * l'état porte une liste `outputs`. C'est le noyau qui la remplit.
     */
    class OutputModel extends base.DOMWidgetModel {
      /**
       * An `Output` claims a `msg_id`, and that is the whole mechanism.
       *
       * `with output:` does not fill the `outputs` trait: the kernel writes
       * its own current parent id into `msg_id`, emits everything under that
       * parent, then clears it. The front end is what must listen. Hence this
       * register, kept in step with the trait.
       */
      initialize(attributes, options) {
        super.initialize(attributes, options);
        this.on("change:msg_id", this.claimMsgId, this);
        this.claimMsgId();
        // What arrived before this model existed, kept under its comm id and
        // claimed here. Being born is the one moment at which a model is
        // certainly able to answer for itself -- `get_model` cannot, since
        // its own construction is what we are inside of.
        const waiting = earlyOutputs.get(this.model_id);
        if (waiting?.length) {
          earlyOutputs.delete(this.model_id);
          wdbg("Output récupère", String(this.model_id).slice(0, 8), waiting.length, "sortie(s) en réserve");
          this.set("outputs", [...(this.get("outputs") ?? []), ...waiting]);
        }
      }

      claimMsgId() {
        wdbg("modèle Output revendique", String(this.get("msg_id") ?? "").slice(0, 8) || "(rien)");
        for (const [id, model] of outputTargets) {
          if (model === this) {
            outputTargets.delete(id);
            releaseOutputParent(id);
          }
        }
        const id = this.get("msg_id");
        if (id) {
          outputTargets.set(id, this);
          // Told to the router as well: the claim has to hold for a cell
          // execution too, not only for a comm message.
          claimOutputParent(id);
          const waiting = earlyOutputs.get(id);
          if (waiting?.length) {
            earlyOutputs.delete(id);
            this.set("outputs", [...(this.get("outputs") ?? []), ...waiting]);
          }
        }
      }

      defaults() {
        return {
          ...super.defaults(),
          _model_name: "OutputModel",
          _model_module: "@jupyter-widgets/output",
          _view_name: "OutputView",
          _view_module: "@jupyter-widgets/output",
          outputs: [],
        };
      }
    }

    /** Sa vue : les sorties, rendues comme celles d'une cellule. */
    class OutputView extends base.DOMWidgetView {
      render() {
        this.el.className = "pyodide-widget-output";
        this.model.on("change:outputs", this.draw, this);
        this.draw();
      }

      draw() {
        const outputs = this.model.get("outputs") ?? [];
        const kinds = outputs.map(kindOfOutput);
        wdbg("vue Output dessine", String(this.model.model_id ?? "").slice(0, 8), outputs.length, "sortie(s)");

        // Same shape as last time: update what is there rather than rebuild.
        // An animation redraws the same single image over and over, and it is
        // the rebuilding, not the drawing, that made the page jump.
        const children = [...this.el.children];
        const sameShape = this.kinds?.length === kinds.length && children.length === kinds.length && this.kinds.every((k, i) => k === kinds[i]);
        if (sameShape && outputs.every((out, i) => patchOutputItem(children[i], out, kinds[i]))) {
          this.kinds = kinds;
          return;
        }

        this.el.textContent = "";
        for (const out of outputs) renderOutputItem(this.el, out, space);
        this.kinds = kinds;
      }
    }

    const manager = new MystralWidgetManager();

    // Le noyau ouvre un comm pour chaque modèle qu'il crée ; c'est là que le
    // gestionnaire apprend qu'un widget existe. Les autres messages lui
    // parviennent par le comm correspondant, qui les tient de ce même
    // routage -- et qui peuvent arriver longtemps après la cellule.
    onComm((msg, msgSpace) => {
      if (msgSpace !== space) return;
      const id = msg.content?.comm_id;
      if (!id) return;
      wdbg("manager", msg.msg_type, String(id).slice(0, 8), msg.content?.target_name ?? "");
      if (msg.msg_type === "comm_open") {
        if (msg.content?.target_name !== WIDGET_TARGET) return;
        const comm = new KernelComm(space, id);
        comms.set(id, comm);
        manager.handle_comm_open(comm, msg).catch((err) => console.warn("[widgets] modèle refusé :", err));
        return;
      }
      const comm = comms.get(id);
      if (!comm) return;
      comm.deliver(msg);
      if (msg.msg_type === "comm_close") comms.delete(id);
    });

    /**
     * What a comm message provokes, put where it belongs.
     *
     * An `Output` that has claimed this parent takes it -- that is
     * `with output:`, and `interact`, which builds one. Otherwise it goes to
     * the cell that holds the widget which sent the message: a bare `observe`
     * that prints has no `Output` to call its own, and printing into the void
     * is what made it look broken.
     *
     * The outputs are set on the model but never saved back: they come from
     * the kernel, and returning them would echo its own words at it.
     */
    onCommOutput((msg, { msgId, commId, space: msgSpace }) => {
      if (msgSpace !== space) return;
      wdbg(
        "tap",
        msg.msg_type,
        "parent =",
        String(msgId ?? "").slice(0, 8),
        "cible =",
        Boolean(outputTargets.get(msgId)),
        "revendiqué =",
        isOutputParent(msgId),
      );
      const deliver = (model) => {
        if (!model) return wdbg("livraison sans modèle", String(commId ?? "").slice(0, 8));
        if (msg.msg_type === "clear_output") {
          // `wait` is the whole of what makes an animation watchable: it means
          // "clear when the next output is here", not "clear now". Emptying at
          // once is what let the text below ride up into the space the figure
          // had just left. `interact` always asks for it.
          if (msg.content?.wait) deferredClear.add(model);
          else {
            deferredClear.delete(model);
            model.set("outputs", []);
          }
          return;
        }
        const item = toOutputItem(msg);
        if (!item) return;
        const base = deferredClear.delete(model) ? [] : (model.get("outputs") ?? []);
        model.set("outputs", [...base, item]);
        wdbg("livré à", String(model.model_id ?? "").slice(0, 8), model.get("_model_name"), "→", (model.get("outputs") ?? []).length, "sortie(s)");
      };

      const target = outputTargets.get(msgId);
      if (target) return deliver(target);

      // No live claim, but the message carries the comm that claimed it when
      // it was diverted. A comm id names its model for good, where a `msg_id`
      // names it only for the length of a `with output:` block -- and that
      // block is long over by the time a buffered message is replayed.
      if (commId) {
        const known = manager.get_model(commId);
        if (known) {
          known.then(deliver).catch(() => {});
          return;
        }
        // The claiming model is still being built -- on a session's first
        // widget, its construction is still in flight when its first outputs
        // land. Held under its **comm** id, which it will answer to as soon
        // as it exists; held under the `msg_id`, as before, nothing ever came
        // to collect it, the kernel having already released the claim.
        if (msg.msg_type === "clear_output") {
          earlyOutputs.set(commId, []);
          return;
        }
        const early = toOutputItem(msg);
        if (early) earlyOutputs.set(commId, [...(earlyOutputs.get(commId) ?? []), early]);
        wdbg("mise en réserve sous", String(commId).slice(0, 8), earlyOutputs.get(commId)?.length ?? 0);
        return;
      }
      if (isOutputParent(msgId)) return;
      const item = toOutputItem(msg);
      const host = commId ? hosts.get(commId) : null;
      if (item && host?.parentElement) renderOutputItem(host.parentElement, item, space);
    });

    console.log(`[widgets] gestionnaire prêt pour l'espace ${space}`);
    return manager;
  })();

  managers.set(space, ready);
  return ready;
}

if (typeof window !== "undefined") {
  // Depuis la console, le temps que les vues existent :
  //   const m = await mystralWidgets(); m.get_model(…)
  window.mystralWidgets = widgetManagerFor;
}
