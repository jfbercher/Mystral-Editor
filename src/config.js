const BUILTIN_DIRECTIVES = {
  // Médias
  figure: { kind: "fig", label: "Figure", numbered: true, caption: "body" },
  "figure-md": { kind: "fig", label: "Figure", numbered: true, caption: "body", argIsLabel: true },
  image: { kind: "fig", label: "Image", numbered: false },
  table: { kind: "table", label: "Table", numbered: true, caption: "both" },
  "list-table": { kind: "table", label: "Table", numbered: true, caption: "both" },
  "csv-table": { kind: "table", label: "Table", numbered: true, caption: "both" },

  // Maths
  math: { kind: "eq", label: "Equation", numbered: true },

  // Exercices — modèle mystmd / sphinx-exercise
  exercise: { kind: "exercise", label: "Exercise", numbered: true, caption: "arg" },
  solution: { kind: "solution", label: "Solution", numbered: false, caption: "arg", reference: true },
  // Syntaxe « gated » : deux fences indépendantes encadrant du contenu racine.
  "exercise-start": { kind: "exercise", label: "Exercise", numbered: true, caption: "arg" },
  "exercise-end": { kind: null },
  "solution-start": { kind: "solution", label: "Solution", numbered: false, caption: "arg", reference: true },
  "solution-end": { kind: null },

  // Famille preuve
  proof: { kind: "proof", label: "Proof", numbered: true, caption: "arg" },
  theorem: { kind: "theorem", label: "Theorem", numbered: true, caption: "arg" },
  lemma: { kind: "theorem", label: "Lemma", numbered: true, caption: "arg" },
  corollary: { kind: "theorem", label: "Corollary", numbered: true, caption: "arg" },
  definition: { kind: "definition", label: "Definition", numbered: true, caption: "arg" },
  example: { kind: "example", label: "Example", numbered: true, caption: "arg" },
  remark: { kind: "remark", label: "remark", numbered: true, caption: "arg" },
  algorithm: { kind: "algorithm", label: "Algorithm", numbered: true, caption: "arg" },

  // Admonitions : référençables mais non numérotées
  admonition: { kind: "adm", label: "Admonition", numbered: false, caption: "arg" },
  attention: { kind: "adm", label: "Attention", numbered: false, caption: "arg" },
  caution: { kind: "adm", label: "Caution", numbered: false, caption: "arg" },
  danger: { kind: "adm", label: "Danger", numbered: false, caption: "arg" },
  error: { kind: "adm", label: "Error", numbered: false, caption: "arg" },
  hint: { kind: "adm", label: "Hint", numbered: false, caption: "arg" },
  important: { kind: "adm", label: "Important", numbered: false, caption: "arg" },
  note: { kind: "note", label: "Note", numbered: true, caption: "arg" },
  seealso: { kind: "adm", label: "See also", numbered: false, caption: "arg" },
  tip: { kind: "adm", label: "Tip", numbered: false, caption: "arg" },
  warning: { kind: "adm", label: "Warning", numbered: true, caption: "arg" },
};


export const config = {
  suspendAfterMs: 60 * 60 * 1000,
  checkIntervalMs: 5 * 60 * 1000,
  autosaveIntervalMs: 60 * 1000,

  recentFilesMax: 10,
  defaultFileName: "Untitled.md",

  fallbackImage:
    "https://upload.wikimedia.org/wikipedia/commons/a/a3/Image-not-found.png",

  shortcuts: {
    save: "Mod-Shift-s",
    open: "Mod-Shift-o",
    newTab: "Mod-Shift-e",
  },
};

let directives = BUILTIN_DIRECTIVES;
let customCss = "";
let ready = null;

export function loadConfig() {
  ready ??= (async () => {
    try {
      const res = await fetch(new URL("config.json", import.meta.url));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const { shortcuts, data_directives, ...rest } = data;
      Object.assign(config, rest);
      Object.assign(config.shortcuts, shortcuts ?? {});
      directives = { ...BUILTIN_DIRECTIVES, ...(data_directives ?? {}) };
    } catch (err) {
      console.warn("config.json non chargé, valeurs par défaut.", err);
    }
    try {
        const res = await fetch("custom.css");
        if (res.ok) {customCss = await res.text(); console.log("custom.css loaded")}
      } catch {
        // Absence de fichier : cas normal, pas une erreur.
      }
    return config;
  })();
  return ready;
}

export const configReady = () => ready ?? loadConfig();

export const getLabelledDirectives = () => directives;
export const getCustomCss = () => customCss;