/**
 * Les noyaux Jupyter installés sur cette machine, s'il y en a.
 *
 * Rien n'en dépend aujourd'hui : c'est la deuxième inconnue du point 50 du
 * backlog, celle du PATH, répondue par une mesure plutôt que par une
 * supposition. Pyodide reste le moteur, et le restera dans le build web où
 * cette fonction ne trouve évidemment rien.
 *
 * **Pourquoi passer par le shell de connexion.** Une application lancée depuis
 * le Finder ou le menu Démarrer n'hérite pas du PATH d'un terminal : elle
 * reçoit un environnement minimal où ni `jupyter`, ni un environnement virtuel,
 * ni un `conda` ne figurent. Un `spawn("jupyter")` échouerait donc chez
 * quelqu'un qui a parfaitement Jupyter installé, ce qui est la pire des
 * réponses — un « non » qui veut dire « je n'ai pas su chercher ». C'est déjà
 * la raison pour laquelle `myst start` passe par `login-shell -lc`, et la
 * découverte emprunte le même chemin, donc le même PATH que l'utilisateur voit
 * dans son terminal.
 */
import { runShellLimited, shq } from "./shell.js";
import { isTauri, isWindows } from "./fs.js";
import { config } from "../../config.js";

/** Ce que `jupyter kernelspec list --json` rend, réduit à ce qui nous servirait. */
const toKernels = (parsed) =>
  Object.entries(parsed?.kernelspecs ?? {}).map(([name, entry]) => ({
    name,
    displayName: entry?.spec?.display_name ?? name,
    language: entry?.spec?.language ?? "",
    argv: entry?.spec?.argv ?? [],
  }));

/**
 * Les noyaux, ou la raison pour laquelle il n'y en a pas.
 *
 * Rend toujours un objet, jamais une exception : « pas de Jupyter » est une
 * réponse ordinaire et non une erreur, et l'interface qui s'en servira un jour
 * doit pouvoir dire *pourquoi* la liste est vide plutôt que de rester muette.
 *
 * @returns {Promise<{ available: boolean, kernels: Array, reason: string }>}
 */
/** Les endroits habituels d'une installation Python sur un poste de travail. */
const JUPYTER_CANDIDATES = [
  '"$HOME"/anaconda3/envs/*/bin/jupyter',
  '"$HOME"/miniconda3/envs/*/bin/jupyter',
  '"$HOME"/miniforge3/envs/*/bin/jupyter',
  "/opt/anaconda3/envs/*/bin/jupyter",
  "/opt/miniconda3/envs/*/bin/jupyter",
  "/opt/homebrew/Caskroom/miniforge/base/envs/*/bin/jupyter",
  '"$HOME"/anaconda3/bin/jupyter',
  '"$HOME"/miniconda3/bin/jupyter',
  "/opt/anaconda3/bin/jupyter",
  '"$HOME"/.local/bin/jupyter',
  '"$HOME"/.pyenv/shims/jupyter',
  "/opt/homebrew/bin/jupyter",
  "/usr/local/bin/jupyter",
];

/** Trouvé par sondage, pour cette séance, quand `config.json` ne nomme rien. */
let probedJupyter = null;

/**
 * Le `jupyter` que l'utilisateur a choisi, ou rien.
 *
 * `jupyter.command` vaut le nom nu par défaut, donc sa seule présence ne dit
 * rien : seule une valeur qui s'en écarte est un choix. Même raisonnement que
 * pour `export.mystPath`, et pour la même raison -- prendre le défaut pour un
 * réglage empêcherait le sondage de jamais tourner.
 */
const configuredJupyter = () => {
  const value = String(config.jupyter?.command ?? "").trim();
  return value && value !== "jupyter" ? value : null;
};

/**
 * Trouver l'exécutable, puisque le PATH ne le dira pas.
 *
 * Une application lancée depuis le Finder n'hérite d'aucun environnement de
 * terminal, et `conda init` n'agit que dans un shell interactif : un `jupyter`
 * parfaitement installé dans un environnement conda y est invisible, et
 * `sh -lc` répond « command not found » en quatre millisecondes.
 *
 * Trois marches, de la moins chère à la plus chère, comme pour myst. Les
 * chemins absolus d'abord, une boucle `for` sur des motifs qui répond
 * instantanément et qu'un `jupyter.searchPaths` dans `config.json` étend. Le
 * shell **interactif** ensuite, lent parce qu'il lit `~/.zshrc`, mais c'est
 * justement ce que `conda init` y écrit : il trouve ce qu'aucune liste ne
 * prévoira. Le PATH en dernier, par les tentatives ordinaires de l'appelant.
 */
async function locateJupyter({ timeoutMs = 20000 } = {}) {
  // Rien à chercher : Windows donne son PATH à l'application.
  if (isWindows) return null;
  if (configuredJupyter()) return configuredJupyter();
  if (probedJupyter) return probedJupyter;

  const list = [...JUPYTER_CANDIDATES, ...(config.jupyter?.searchPaths ?? [])].join(" ");
  const quick = await runShellLimited(`for p in ${list}; do [ -x "$p" ] && printf '%s\n' "$p" && exit 0; done; exit 1`, { timeoutMs: 8000 });
  let found = (quick.code === 0 && quick.stdout.trim().split("\n")[0]?.trim()) || "";

  if (!found) {
    const deep = await runShellLimited(
      `for s in zsh bash; do command -v $s >/dev/null 2>&1 || continue; ` +
        `p=$("$s" -ilc 'command -v jupyter' 2>/dev/null | tail -n 1); ` +
        `[ -x "$p" ] && printf '%s\n' "$p" && exit 0; done; exit 1`,
      { timeoutMs },
    );
    found = (deep.code === 0 && deep.stdout.trim().split("\n")[0]?.trim()) || "";
  }

  if (found) {
    probedJupyter = found;
    console.log(`[jupyter] trouvé hors du PATH : ${found} — pour le figer, posez jupyter.command dans config.json`);
  }
  return found || null;
}

export async function listJupyterKernels({ timeoutMs = 45000 } = {}) {
  if (!isTauri) return { available: false, kernels: [], reason: "le build web n'a pas de machine où chercher" };

  // `jupyter` d'abord, `python -m jupyter` ensuite : une installation faite
  // par pip place souvent le module sans mettre son script sur le PATH, et
  // c'est précisément le cas qu'un spawn direct manquerait.
  //
  // Mais le PATH ne suffit pas, et c'est le cas le plus courant plutôt que
  // l'exception : une application lancée depuis le Finder n'hérite pas de
  // l'environnement d'un terminal, et `conda init` n'agit que dans un shell
  // interactif. Un `jupyter` installé dans un environnement conda --
  // `/opt/anaconda3/envs/jlab/bin/jupyter` -- est alors parfaitement
  // invisible : `sh -lc` répond « command not found » en quatre
  // millisecondes. On va donc le chercher là où il se trouve d'ordinaire,
  // avant de s'en remettre au PATH.
  const found = await locateJupyter();
  const attempts = [
    ...(found ? [`${shq(found)} kernelspec list --json`] : []),
    "jupyter kernelspec list --json",
    "python3 -m jupyter kernelspec list --json",
    "python -m jupyter kernelspec list --json",
  ];
  const tried = [];
  for (const line of attempts) {
    const { code, stdout, stderr, timedOut } = await runShellLimited(line, { timeoutMs });
    if (timedOut) {
      tried.push(`${line} : pas de réponse en ${timeoutMs} ms`);
      continue;
    }
    if (code !== 0 || !stdout.trim()) {
      tried.push(`${line} : code ${code}${stderr.trim() ? ` — ${stderr.trim().split("\n").slice(-1)[0]}` : ""}`);
      continue;
    }
    try {
      const kernels = toKernels(JSON.parse(stdout));
      return { available: kernels.length > 0, kernels, reason: kernels.length ? "" : "Jupyter est là, mais sans aucun noyau installé", via: line };
    } catch {
      tried.push(`${line} : réponse illisible`);
    }
  }
  return { available: false, kernels: [], reason: tried.join(" ; ") };
}

// Appelable depuis la console, comme les autres sondes de ce projet :
//   await window.mystralJupyterKernels()
if (typeof window !== "undefined") window.mystralJupyterKernels = listJupyterKernels;
