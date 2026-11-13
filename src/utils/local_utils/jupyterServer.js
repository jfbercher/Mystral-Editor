/**
 * Lancer et arrêter un serveur Jupyter local.
 *
 * Point 50 du backlog, deuxième étape. Rien ne s'en sert encore : les cellules
 * continuent de tourner dans Pyodide, et ce module ne fait qu'ouvrir la porte
 * — un noyau joignable sur le bouclage local, avec son jeton et son port.
 *
 * **Même forme que `startSite`**, délibérément, et pour la même raison de
 * fond : un serveur lancé depuis l'éditeur engendre des enfants — ici les
 * noyaux eux-mêmes — qui survivent à la mort du shell et gardent le port. Le
 * remède est celui qui a déjà été trouvé pour `myst start` : `set -m` donne au
 * travail d'arrière-plan un groupe de processus à lui, dont le numéro est
 * renvoyé en écho sur une ligne marquée, et c'est ce groupe entier que l'on
 * retire. Une seconde invention aurait été une seconde occasion de se tromper.
 *
 * **Ce que ce module ne fait pas.** Il ne parle pas au serveur. La CSP refuse
 * `ws://127.0.0.1` et `wss://127.0.0.1` — mesuré, pas supposé — et elle refuse
 * tout autant un `fetch` vers lui, puisque `connect-src` ne liste pas le
 * bouclage local. Les deux chemins, la WebSocket des noyaux *et* les appels
 * REST qui les créent, passeront donc par Rust. C'est le pas suivant.
 */
import { isTauri, isWindows } from "./fs.js";
import { runShell, runShellLimited, LOGIN_SHELL, WINDOWS_SHELL, shq } from "./shell.js";
import { listJupyterKernels } from "./jupyterKernels.js";
import { showToast } from "../utils_ui.js";

const PGID_MARK = "MYSTRAL_JUPYTER_PGID=";
const PGID_RE = new RegExp(`${PGID_MARK}(\\d+)`);

let child = null;
let pgid = null;
let port = null;
let token = null;
let stopping = false;

/** Un serveur lancé d'ici tourne-t-il ? */
export const jupyterRunning = () => child !== null;
/** L'adresse du serveur, ou null : à donner au relais, jamais à un `fetch` d'ici. */
export const jupyterUrl = () => (port ? `http://127.0.0.1:${port}` : null);
/** Le jeton de cette instance. Vit en mémoire et nulle part ailleurs. */
export const jupyterToken = () => token;

/**
 * Démarrer le serveur, et rendre son adresse une fois qu'il écoute.
 *
 * Le port n'est pas choisi : on demande 0, le serveur en prend un de libre et
 * annonce lequel. Lire l'annonce est plus sûr que faire confiance à la
 * demande — la leçon est celle de `myst start`, qui déménage quand son port
 * est pris.
 */
export async function startJupyter({ dir, timeoutMs = 30000 } = {}) {
  if (!isTauri) return { ok: false, reason: "le build web n'a pas de machine où lancer un serveur" };
  if (child) return { ok: true, url: jupyterUrl(), token };

  // La même invocation que celle qui a trouvé les noyaux : `jupyter` n'est pas
  // toujours sur le PATH là où le module l'est.
  const found = await listJupyterKernels();
  if (!found.available) return { ok: false, reason: found.reason || "aucun noyau Jupyter sur cette machine" };
  const invocation = (found.via ?? "jupyter kernelspec list --json").replace(" kernelspec list --json", "");

  token = crypto.randomUUID();
  // Un port demandé, pas zéro. `--ServerApp.port=0` veut dire « prends-en un de
  // libre » pour le système, mais Jupyter 2.17 l'annonce tel quel -- un
  // `http://127.0.0.1:0/` dans le journal *et* dans sa propre liste, mesuré.
  // On en choisit donc un au hasard dans une plage haute, et `port_retries`
  // laisse le serveur en prendre un autre s'il est déjà pris ; la liste dira
  // lequel. Comme pour `myst start` : demander est une chose, savoir sur quoi
  // il écoute vraiment en est une autre.
  const wanted = 8900 + Math.floor(Math.random() * 500);
  const args =
    `server --no-browser --ServerApp.ip=127.0.0.1 --ServerApp.port=${wanted} --ServerApp.port_retries=50 ` +
    `--IdentityProvider.token=${token} --ServerApp.open_browser=False`;

  const { Command } = await import("@tauri-apps/plugin-shell");
  const line = isWindows
    ? `${invocation} ${args}`
    : `${dir ? `cd ${shq(dir)} && ` : ""}set -m\n${invocation} ${args} < /dev/null &\necho "${PGID_MARK}$!"\nwait $!`;
  const [scope, cmdArgs] = isWindows ? [WINDOWS_SHELL, ["/d", "/s", "/c", line]] : [LOGIN_SHELL, ["-lc", line]];
  const cmd = Command.create(scope, cmdArgs, dir ? { cwd: dir } : {});

  const watch = (data) => {
    const text = String(data);
    console.log("[jupyter]", text.trimEnd());
    const group = PGID_RE.exec(text);
    if (group) pgid = Number(group[1]);
  };
  cmd.stdout.on("data", watch);
  // Jupyter annonce son adresse sur la sortie d'erreur, pas sur la standard.
  cmd.stderr.on("data", watch);
  cmd.on("close", (data) => {
    const unexpected = child && !stopping;
    child = null;
    pgid = null;
    port = null;
    token = null;
    stopping = false;
    if (unexpected) showToast(`le serveur Jupyter s'est arrêté seul (code ${data?.code ?? "?"})`, "error", 0);
  });

  try {
    child = await cmd.spawn();
  } catch (err) {
    return { ok: false, reason: `le serveur n'a pas pu être lancé : ${err}` };
  }

  // L'adresse ne se lit pas dans le journal : le serveur l'y annonce avant
  // d'avoir lié son port, et un `:0` y figure donc, qui est un port faux. Elle
  // se demande à Jupyter lui-même -- `server list --json` dit quels serveurs
  // tournent, avec leur port et leur jeton -- ce qui ne dépend ni du format du
  // journal ni de la version. Le jeton, qui n'est qu'à nous, reconnaît le nôtre
  // parmi ceux que l'utilisateur aurait déjà lancés de son côté.
  const ours = async () => {
    const { code, stdout } = await runShellLimited(`${invocation} server list --json`, { timeoutMs: 8000 });
    if (code !== 0) return null;
    for (const raw of String(stdout).split("\n")) {
      const trimmed = raw.trim();
      if (!trimmed.startsWith("{")) continue;
      try {
        const entry = JSON.parse(trimmed);
        if (entry.token === token) return entry;
      } catch {
        // Une ligne qui n'est pas du JSON n'est pas une erreur : la commande
        // préfixe parfois sa liste d'une phrase.
      }
    }
    return null;
  };

  const deadline = Date.now() + timeoutMs;
  let entry = null;
  while (!entry && Date.now() < deadline && child) {
    entry = await ours();
    if (!entry) await new Promise((r) => setTimeout(r, 400));
  }
  if (!entry) {
    await stopJupyter();
    return { ok: false, reason: `le serveur n'était pas dans la liste après ${timeoutMs} ms` };
  }
  // Le port annoncé, et à défaut celui demandé : cette version écrit parfois
  // zéro dans sa liste, et zéro n'est l'adresse de rien.
  port = entry.port > 0 ? entry.port : wanted;
  console.log("[jupyter] entrée de la liste :", JSON.stringify(entry));
  console.log(`[jupyter] à l'écoute sur ${jupyterUrl()}`);
  return { ok: true, url: jupyterUrl(), token };
}

/**
 * Arrêter le serveur, et avec lui les noyaux qu'il a ouverts.
 *
 * Le groupe de processus, pas le seul shell : c'est la différence entre un
 * port rendu et un port gardé par des noyaux orphelins.
 */
export async function stopJupyter() {
  if (!child) return;
  stopping = true;
  const group = pgid;
  const current = child;

  if (isWindows) {
    if (current.pid) await runShell(`taskkill /F /T /PID ${current.pid}`).catch(() => {});
  } else if (group) {
    await runShell(`kill -INT -${group}`).catch(() => {});
    await new Promise((r) => setTimeout(r, 400));
    if (child) await runShell(`kill -KILL -${group}`).catch(() => {});
  }
  if (child) {
    try {
      await current.kill();
    } catch (err) {
      console.warn("[jupyter] arrêt :", err);
    }
  }
}

// Appelable depuis la console, comme la sonde des noyaux :
//   await window.mystralJupyterStart()   puis   await window.mystralJupyterStop()
if (typeof window !== "undefined") {
  window.mystralJupyterStart = startJupyter;
  window.mystralJupyterStop = stopJupyter;
  window.mystralJupyterStatus = () => ({ running: jupyterRunning(), url: jupyterUrl(), token: jupyterToken() });
}
