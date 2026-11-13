/**
 * Parler à un noyau Jupyter local, par le relais Rust.
 *
 * La CSP de l'application refuse le bouclage à `connect-src` — mesuré, pour
 * `ws://`, `wss://` et pour un simple `fetch`. Ni la socket d'un noyau ni les
 * appels REST qui le créent ne partent donc d'ici : tout passe par les quatre
 * commandes de `src-tauri/src/jupyter.rs`, qui vérifient l'adresse avant
 * d'ouvrir quoi que ce soit.
 *
 * Rien dans l'éditeur ne s'en sert : les cellules tournent dans Pyodide. C'est
 * la troisième étape du point 50 du backlog, et `window.mystralJupyterTry()`
 * en est l'essai de bout en bout.
 */
import { jupyterUrl, jupyterToken, startJupyter } from "./jupyterServer.js";

const tauriCore = () => import("@tauri-apps/api/core");

/** Un appel REST au serveur : créer un noyau, l'interrompre, le supprimer. */
export async function jupyterFetch(method, path, body = null) {
  const base = jupyterUrl();
  if (!base) throw new Error("aucun serveur Jupyter lancé");
  const { invoke } = await tauriCore();
  const reply = await invoke("jupyter_fetch", {
    method,
    url: `${base}${path}`,
    token: jupyterToken(),
    body: body === null ? null : JSON.stringify(body),
  });
  if (reply.status >= 400) throw new Error(`${method} ${path} → ${reply.status} ${reply.body.slice(0, 200)}`);
  return reply.body ? JSON.parse(reply.body) : null;
}

/**
 * Ouvrir la socket d'un noyau. `onMessage` reçoit les messages déjà analysés.
 *
 * Le dernier message d'un lien est toujours `{ mystral: "closed" }` : un canal
 * qui se tait ressemble à un noyau tranquille, et l'appelant doit pouvoir
 * distinguer les deux.
 */
export async function openKernel(kernelId, onMessage) {
  const base = jupyterUrl();
  const { invoke, Channel } = await tauriCore();
  const channel = new Channel();
  channel.onmessage = (text) => {
    try {
      onMessage(JSON.parse(text));
    } catch {
      console.warn("[jupyter] message illisible :", text);
    }
  };
  const ws = base.replace(/^http/, "ws");
  const id = await invoke("jupyter_open", { url: `${ws}/api/kernels/${kernelId}/channels?token=${jupyterToken()}`, onMessage: channel });

  const session = crypto.randomUUID();
  const send = (msgType, content) =>
    invoke("jupyter_send", {
      id,
      text: JSON.stringify({
        header: { msg_id: crypto.randomUUID(), session, username: "mystral", date: new Date().toISOString(), msg_type: msgType, version: "5.3" },
        parent_header: {},
        metadata: {},
        content,
        channel: "shell",
        buffers: [],
      }),
    });

  return {
    id,
    send,
    execute: (code) => send("execute_request", { code, silent: false, store_history: true, user_expressions: {}, allow_stdin: false }),
    close: () => invoke("jupyter_close", { id }),
  };
}

/**
 * L'essai de bout en bout, depuis la console :
 *
 *     await window.mystralJupyterTry()
 *
 * Lance le serveur s'il ne tourne pas, crée un noyau, exécute une cellule,
 * affiche ce qui revient, et range tout. C'est ce que la sonde hors
 * application avait prouvé ; reste à savoir si le relais tient le même rôle.
 */
export async function tryKernel(code = 'import sys\nprint("depuis le noyau")\nprint("une erreur", file=sys.stderr)\n6 * 7') {
  const started = await startJupyter();
  if (!started.ok) return started;

  const specs = await jupyterFetch("GET", "/api/kernelspecs");
  const kernel = await jupyterFetch("POST", "/api/kernels", { name: specs.default });
  console.log("[jupyter] noyau", kernel.id, "|", kernel.name);

  const seen = [];
  const link = await openKernel(kernel.id, (msg) => {
    // La sentinelle du relais n'est pas un message du protocole : elle n'a ni
    // `msg_type` ni contenu, et elle dit seulement que le lien est fermé.
    if (msg.mystral) {
      seen.push(`lien ${msg.mystral}`);
      console.log("[jupyter] lien", msg.mystral);
      return;
    }
    const c = msg.content ?? {};
    const detail =
      msg.msg_type === "stream"
        ? `${c.name}: ${JSON.stringify(c.text)}`
        : msg.msg_type === "execute_result" || msg.msg_type === "display_data"
          ? `mimes: ${Object.keys(c.data ?? {}).join(", ")}`
          : msg.msg_type === "error"
            ? `${c.ename}: ${c.evalue}`
            : msg.msg_type === "status"
              ? c.execution_state
              : "";
    seen.push(`${msg.msg_type} ${detail}`.trim());
    console.log("[jupyter]", msg.msg_type, detail);
  });

  await link.execute(code);
  await new Promise((r) => setTimeout(r, 3000));
  await link.close();
  await jupyterFetch("DELETE", `/api/kernels/${kernel.id}`);
  return { ok: seen.some((l) => l.startsWith("execute_result")), messages: seen };
}

if (typeof window !== "undefined") {
  window.mystralJupyterTry = tryKernel;
  window.mystralJupyterFetch = jupyterFetch;
}
