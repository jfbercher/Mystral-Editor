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
 * ## Ce qui n'est pas encore là
 *
 * Les vues. Ce module crée et tient les modèles à jour ; les dessiner demande
 * `create_view` et l'insertion d'un widget Lumino dans la sortie d'une
 * cellule, plus la feuille de style de `controls`. C'est la passe suivante.
 *
 * Deux limites à connaître, écrites ici pour qu'on ne les redécouvre pas :
 * les **tampons binaires** d'un message de widget (une image dans un modèle,
 * par exemple) voyagent en trames binaires que notre relais, qui ne passe que
 * du texte, laisse tomber ; et le `msg_id` rendu par `send` ne l'est pas
 * vraiment, l'envoi étant asynchrone, ce qui prive des rappels `callbacks`
 * dont seuls les widgets de sortie se servent.
 */
import { onComm, sendComm, listComms } from "./jupyterRuntime.js";
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

  _write(msgType, content) {
    sendComm(this.space, msgType, { comm_id: this.comm_id, ...content }).catch((err) =>
      console.warn(`[widgets] ${msgType} sur ${this.comm_id} :`, err),
    );
    // L'interface veut un identifiant de message ; l'envoi étant asynchrone,
    // il n'existe pas encore. Rendre une chaîne vide est honnête : les rappels
    // qui s'y rattacheraient ne seraient de toute façon pas rendus.
    return "";
  }

  open(data, _callbacks, metadata, _buffers) {
    return this._write("comm_open", { target_name: this.target_name, data: data ?? {}, metadata: metadata ?? {} });
  }

  send(data, _callbacks, metadata, _buffers) {
    return this._write("comm_msg", { data: data ?? {}, metadata: metadata ?? {} });
  }

  close(data, _callbacks, metadata, _buffers) {
    return this._write("comm_close", { data: data ?? {}, metadata: metadata ?? {} });
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
        const mod = moduleName === "@jupyter-widgets/base" ? base : moduleName === "@jupyter-widgets/controls" ? controls : null;
        if (!mod) return Promise.reject(new Error(`module de widgets non embarqué : ${moduleName}`));
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
