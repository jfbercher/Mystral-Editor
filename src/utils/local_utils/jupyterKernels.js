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
import { runShellLimited } from "./shell.js";
import { isTauri } from "./fs.js";

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
export async function listJupyterKernels({ timeoutMs = 15000 } = {}) {
  if (!isTauri) return { available: false, kernels: [], reason: "le build web n'a pas de machine où chercher" };

  // `jupyter` d'abord, `python -m jupyter` ensuite : une installation faite
  // par pip place souvent le module sans mettre son script sur le PATH, et
  // c'est précisément le cas qu'un spawn direct manquerait.
  const attempts = ["jupyter kernelspec list --json", "python3 -m jupyter kernelspec list --json", "python -m jupyter kernelspec list --json"];
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
