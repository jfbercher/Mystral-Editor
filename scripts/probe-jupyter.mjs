/**
 * Sonde : un noyau Jupyter est-il utilisable comme moteur de cellule ?
 *
 *     node scripts/probe-jupyter.mjs
 *
 * Mesure ce que le point 50 du backlog suppose, plutôt que de le supposer :
 * découverte des noyaux, démarrage du serveur, exécution d'une cellule et
 * messages reçus, sortie riche (HTML, PNG), interruption d'une boucle sans
 * fin, complétion et documentation du noyau.
 *
 * Ne dépend de rien : WebSocket est natif depuis Node 22, et le serveur est
 * lancé puis arrêté par la sonde elle-même. Il faut seulement un `jupyter`
 * et un `ipykernel` atteignables -- `pip install jupyter-server ipykernel`
 * suffit, et la sonde dit ce qu'elle ne trouve pas.
 *
 * Ce qu'elle ne peut pas mesurer, et qui reste à vérifier dans l'application :
 * la CSP de src/index.html autorise `frame-src` sur le bouclage local et
 * refuse `connect-src`, donc une WebSocket ouverte depuis la webview peut
 * être rejetée -- auquel cas il faut la relayer par Rust. Une ligne dans la
 * console de l'application, un serveur étant lancé, tranche la question :
 *
 *     new WebSocket("ws://127.0.0.1:8888/api/kernels?token=…")
 *
 * Et sur macOS, une application lancée depuis le Finder hérite d'un PATH
 * minimal où `jupyter` n'est pas : la découverte devra passer par le même
 * `login-shell` que `myst start`, pas par un spawn direct.
 */
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

const PORT = 8899 + (process.pid % 50);
const TOKEN = randomUUID();
const BASE = `http://127.0.0.1:${PORT}`;
const log = (...a) => console.log(...a);

const server = spawn(
  "jupyter",
  [
    "server",
    "--no-browser",
    `--ServerApp.port=${PORT}`,
    "--ServerApp.ip=127.0.0.1",
    `--IdentityProvider.token=${TOKEN}`,
    "--ServerApp.open_browser=False",
    "--ServerApp.disable_check_xsrf=True",
  ],
  { env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` }, stdio: ["ignore", "pipe", "pipe"] },
);
let serverLog = "";
server.stdout.on("data", (d) => (serverLog += d));
server.stderr.on("data", (d) => (serverLog += d));

const api = (path, opts = {}) =>
  fetch(`${BASE}${path}`, { ...opts, headers: { Authorization: `token ${TOKEN}`, "Content-Type": "application/json", ...(opts.headers ?? {}) } });

const waitReady = async () => {
  for (let i = 0; i < 60; i++) {
    try {
      if ((await api("/api/status")).ok) return true;
    } catch {
      /* pas encore */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
};

const message = (type, content) => ({
  header: { msg_id: randomUUID(), session: SESSION, username: "probe", date: new Date().toISOString(), msg_type: type, version: "5.3" },
  parent_header: {},
  metadata: {},
  content,
  channel: "shell",
  buffers: [],
});
const SESSION = randomUUID();

const t0 = Date.now();
try {
  if (!(await waitReady())) throw new Error("le serveur n'a pas démarré :\n" + serverLog.slice(-800));
  log(`serveur prêt en ${Date.now() - t0} ms sur ${BASE}`);

  const specs = await (await api("/api/kernelspecs")).json();
  log("noyaux disponibles :", Object.keys(specs.kernelspecs).join(", "));

  const kernel = await (await api("/api/kernels", { method: "POST", body: JSON.stringify({ name: specs.default }) })).json();
  log("noyau créé :", kernel.id, "|", kernel.name);

  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/kernels/${kernel.id}/channels?token=${TOKEN}`);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = (e) => rej(new Error("WebSocket refusée: " + e.message));
  });
  log("WebSocket ouverte");

  const code = 'import sys\nprint("sortie standard")\nprint("une erreur", file=sys.stderr)\n6 * 7';
  const tExec = Date.now();
  const seen = [];
  await new Promise((resolve) => {
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      const c = m.content ?? {};
      const detail =
        m.msg_type === "stream"
          ? `${c.name}: ${JSON.stringify(c.text)}`
          : m.msg_type === "execute_result"
            ? `${JSON.stringify(c.data["text/plain"])} (mimes: ${Object.keys(c.data).join(",")})`
            : m.msg_type === "status"
              ? c.execution_state
              : m.msg_type === "execute_input"
                ? "(le code renvoyé en écho)"
                : m.msg_type === "execute_reply"
                  ? c.status
                  : "";
      seen.push(`${String(Date.now() - tExec).padStart(5)} ms  ${m.channel.padEnd(7)} ${m.msg_type.padEnd(16)} ${detail}`);
      if (m.msg_type === "status" && c.execution_state === "idle" && seen.length > 2) resolve();
    };
    ws.send(JSON.stringify(message("execute_request", { code, silent: false, store_history: true, user_expressions: {}, allow_stdin: false })));
  });
  log("\n--- messages reçus pour une cellule ---");
  seen.forEach((l) => log(l));

  // --- Ce qui décide vraiment : sortie riche, interruption, introspection ---
  const runUntilIdle = (src) =>
    new Promise((resolve) => {
      const out = [];
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        const c = m.content ?? {};
        if (m.msg_type === "display_data" || m.msg_type === "execute_result") out.push("mimes: " + Object.keys(c.data).join(", "));
        if (m.msg_type === "error") out.push(`${c.ename}: ${c.evalue}`);
        if (m.msg_type === "stream") out.push(`${c.name}: ${JSON.stringify(c.text.slice(0, 60))}`);
        if (m.msg_type === "status" && c.execution_state === "idle") resolve(out);
      };
      ws.send(
        JSON.stringify(message("execute_request", { code: src, silent: false, store_history: true, user_expressions: {}, allow_stdin: false })),
      );
    });
  const ask = (type, content) =>
    new Promise((resolve) => {
      ws.onmessage = (ev) => {
        const m = JSON.parse(ev.data);
        if (m.msg_type === type.replace("_request", "_reply")) resolve(m.content);
      };
      ws.send(JSON.stringify(message(type, content)));
    });

  log("\n--- sortie riche ---");
  log("HTML   :", (await runUntilIdle('from IPython.display import HTML, Image\nHTML("<b>gras</b>")')).join(" | "));
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  log("PNG    :", (await runUntilIdle(`Image(b64decode("${png}"))`.replace("b64decode", "__import__('base64').b64decode"))).join(" | "));

  log("\n--- interruption d'une boucle sans fin ---");
  const tInt = Date.now();
  const spin = runUntilIdle("while True:\n    pass");
  await new Promise((r) => setTimeout(r, 600));
  await api(`/api/kernels/${kernel.id}/interrupt`, { method: "POST" });
  log("résultat :", (await spin).join(" | "), `— reprise en ${Date.now() - tInt} ms`);

  log("\n--- introspection du noyau ---");
  await runUntilIdle("import math\nvaleur = 3");
  const comp = await ask("complete_request", { code: "math.sq", cursor_pos: 7 });
  log("complete_request :", comp.matches?.slice(0, 4).join(", "));
  const insp = await ask("inspect_request", { code: "math.sqrt", cursor_pos: 9, detail_level: 0 });
  log(
    "inspect_request  :",
    (insp.data?.["text/plain"] ?? "")
      .split("\n")
      .find((l) => l.trim())
      ?.slice(0, 70),
  );

  ws.close();
  await api(`/api/kernels/${kernel.id}`, { method: "DELETE" });
  log("\nnoyau supprimé.");
} catch (e) {
  log("ÉCHEC :", e.message);
} finally {
  server.kill("SIGTERM");
}
