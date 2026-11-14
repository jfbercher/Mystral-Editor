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
import { onComm, sendCommMessage, listComms } from "./jupyterRuntime.js";
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
  await adoptWidgetStyles(host.getRootNode?.());
  const view = await manager.create_view(model);
  const panel = view.luminoWidget ?? view.pWidget ?? null;
  if (panel) {
    const { Widget } = await import("@lumino/widgets");
    Widget.attach(panel, host);
  } else {
    host.appendChild(view.el);
  }
  return view;
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
        this.el.textContent = "";
        const outputs = this.model.get("outputs") ?? [];
        // Un `with output:` ne remplit pas ce trait : le noyau pose un
        // `msg_id` sur le modèle et émet les sorties sur iopub avec ce
        // `msg_id` pour parent, à charge du client de les capter. Notre
        // routage sait le faire -- c'est ce que `pending` fait pour une
        // cellule -- mais la vue n'y est pas encore branchée. Le dire plutôt
        // que de laisser un cadre vide : c'est le même silence qui nous a
        // fait croire que le modèle ne se chargeait pas.
        if (!outputs.length && this.model.get("msg_id")) {
          const note = document.createElement("div");
          note.className = "pyodide-widget-note";
          note.textContent = "Output widget: the kernel is capturing into it, but this editor does not tap iopub for it yet";
          this.el.appendChild(note);
          return;
        }
        for (const out of outputs) {
          const kind = out?.output_type;
          if (kind === "stream") {
            const pre = document.createElement("pre");
            pre.className = out.name === "stderr" ? "pyodide-stderr" : "pyodide-stdout";
            pre.textContent = Array.isArray(out.text) ? out.text.join("") : (out.text ?? "");
            this.el.appendChild(pre);
          } else if (kind === "error") {
            const pre = document.createElement("pre");
            pre.className = "pyodide-stderr";
            pre.textContent = (out.traceback ?? []).join("\n") || `${out.ename}: ${out.evalue}`;
            this.el.appendChild(pre);
          } else if (out?.data) {
            const png = out.data["image/png"];
            const html = out.data["text/html"];
            if (png) {
              const img = document.createElement("img");
              img.src = `data:image/png;base64,${png}`;
              img.className = "pyodide-figure";
              this.el.appendChild(img);
            } else if (html) {
              const block = document.createElement("div");
              block.className = "pyodide-html";
              block.innerHTML = DOMPurify.sanitize(html);
              this.el.appendChild(block);
            } else {
              const pre = document.createElement("pre");
              pre.className = "pyodide-stdout";
              pre.textContent = String(out.data["text/plain"] ?? "");
              this.el.appendChild(pre);
            }
          }
        }
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
