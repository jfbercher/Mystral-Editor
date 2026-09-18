import { scanSectionLabelLines } from "../utils/headingNumbering";
import { getLabelledDirectives, config, configReady } from "../config";

/* ------------------------------------------------------------------ *
 * Table déclarative des directives ciblables
 *
 * Ajouter une directive numérotée ou référençable = ajouter une ligne ici.
 *
 *   kind      : famille utilisée par refMap, kindLabel et les complétions.
 *               `null` = directive reconnue mais non enregistrée (formes -end).
 *   numbered  : participe à un compteur, piloté par numberingEnabled[kind]
 *   caption   : "arg"  -> le texte après {nom} sur la ligne d'ouverture
 *               "body" -> le premier paragraphe après les options
 *               "both" -> arg si présent, sinon body
 *   reference : l'argument est le label d'une autre cible (cas de `solution`)
 * ------------------------------------------------------------------ */

const LABELLED_DIRECTIVES = getLabelledDirectives();

const byKind = (table) => {
  const out = {};
  for (const [name, spec] of Object.entries(table)) {
    if (spec.kind && !out[spec.kind]) out[spec.kind] = spec;
  }
  return out;
};


export const kindLabelsFrom = (table) =>
  Object.fromEntries(Object.entries(table).map(([kind, spec]) => [kind, spec.label ?? kind]));

export const numberedByKindFrom = (table) =>
  Object.fromEntries(Object.entries(table).map(([kind, spec]) => [kind, !!spec.numbered]));

export const numberedByNameFrom = (table) =>
  Object.fromEntries(Object.entries(table).filter(([, s]) => s.kind).map(([name, s]) => [name, !!s.numbered]));

export const labelsByName = (table) =>
  Object.fromEntries(Object.entries(table).filter(([, s]) => s.kind).map(([name, s]) => [name, s.label ?? name]));

export const getNumberedSignature = (byLabel) => {
  const parts = [];
  for (const [label, info] of byLabel) {
    if (info.number == null) continue;
    parts.push(`${label}:${info.kind}:${info.number}`);
  }
  return parts.join("|");
};

export function getSectionLabelsSignature(byLabel) {
  const entries = [];
  for (const [label, info] of byLabel.entries()) {
    if (info.kind === "sec") entries.push(`${label}:${info.number}:${info.title}`);
  }
  entries.sort();
  return entries.join("|");
}


/* ------------------------------------------------------------------ *
 * Expressions régulières
 * ------------------------------------------------------------------ */

const FENCE_OPEN = /^(\s*)([`:~]{3,})\s*\{([\w:-]+)\}\s*(.*)$/;
const FENCE_CLOSE = /^\s*([`:~]{3,})\s*$/;
/** Bloc de code ordinaire : ```python, ````markdown, ~~~ … */
const CODE_OPEN = /^\s*([`~]{3,})/;
/** `label` est canonique, `name` en est l'alias (spec mystmd). */
const LABEL_OPTION = /^\s*:(?:label|name):\s*(\S+)/;
const ENUMERATED = /^\s*:(?:enumerated|numbered):\s*(\S*)\s*$/i;
const ANY_OPTION = /^\s*:[\w-]+:/;
const TEX_LABEL = /\\label\{([^}]+)\}/;

const MATH_ENVS = ["equation", "align", "gather", "multline"];

/* ------------------------------------------------------------------ *
 * Scan
 * ------------------------------------------------------------------ */

export function scanTargets(fullText, numberingEnabled = null, headingMap = null) {
  
  const enabled = numberingEnabled ?? {};
  const byLine = new Map();
  const byLabel = new Map();

  /** Un compteur par `kind`, créé à la demande. */
  const counters = {};
  /*const nextNumber = (kind) => {
    counters[kind] = (counters[kind] ?? 0) + 1;
    return enabled[kind] ? counters[kind] : "??";
  };*/

  const nextNumber = (name, kind) => {
    if (!enabled[name]) return null;
    counters[kind] = (counters[kind] ?? 0) + 1;
    return counters[kind];
  };

  const settleNumber = (frame) => {
    if (frame.numbered || !frame.wantsNumber) return;
    frame.numbered = true;
    counters[frame.spec.kind] = (counters[frame.spec.kind] ?? 0) + 1;
    frame.number = counters[frame.spec.kind];
    const entry = byLine.get(frame.line);
    if (entry) entry.number = frame.number;
  };

  /** Pile des blocs ouverts, pour gérer l'imbrication. */
  const stack = [];
  const top = () => stack[stack.length - 1];

  /** Bloc dont le contenu ne doit pas être scanné (code, directive inconnue). */
  const pushOpaque = (marker) => {
    stack.push({ char: marker[0], len: marker.length, spec: null, opaque: true, caption: [], label: null });
  };

  // Équations hors directive ($$ … $$, \begin{equation} … )
  let mathLine = null;

  const lines = fullText.split("\n");

  const closeTop = () => {
    const frame = stack.pop();
    if (!frame?.spec?.kind) return;
    settleNumber(frame);

    const entry = byLine.get(frame.line);
    const title = frame.caption.join(" ").trim();
    if (entry) entry.title = title;

    if (frame.label) {
      if (entry) entry.label = frame.label;
      byLabel.set(frame.label, {
        number: frame.number,
        kind: frame.spec.kind,
        name: frame.name,
        title,
        line: frame.line,
        reference: frame.reference ?? null,
      });
    }
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lineNo = i + 1;
    const frame = top();

    // ---------- Fermeture du bloc courant ----------
    if (frame) {
      const close = FENCE_CLOSE.exec(line);
      if (close && close[1][0] === frame.char && close[1].length >= frame.len) {
        closeTop();
        continue;
      }
      // Contenu d'un bloc opaque : on n'y cherche rien.
      if (frame.opaque) continue;
    }

    // ---------- Ouverture d'une directive ----------
    const open = FENCE_OPEN.exec(line);
    if (open) {
      const [, , marker, name, rawArg] = open;
      const spec = LABELLED_DIRECTIVES[name];
      const arg = rawArg.trim();

      if (!spec || !spec.kind) {
        // Directive inconnue ou forme -end : empilée pour que sa clôture
        // ne soit pas prise pour celle d'un bloc englobant.
        pushOpaque(marker);
        continue;
      }

      //const number = spec.numbered ? nextNumber(spec.kind) : null;
      const wantsNumber = spec.numbered && !!enabled[name];
      // const number = spec.numbered ? nextNumber(name, spec.kind) : null;
      //const number = enabled.math ? (counters.eq = (counters.eq ?? 0) + 1) : null;
      const useArg = spec.caption === "arg" || spec.caption === "both";
      // Pour `solution`, l'argument est un label d'exercice, pas une légende.
      const caption = useArg && arg && !spec.reference ? [arg] : [];

      byLine.set(lineNo, { number: null, label: null, kind: spec.kind, name, title: caption[0] ?? "" });

      stack.push({
        char: marker[0],
        len: marker.length,
        line: lineNo,
        name,          
        spec,
        wantsNumber,
        numbered: false,
        number: null,
        //label: null,
        label: spec.argIsLabel ? arg || null : null, // Pour figure-md, le label est l'argument, pas une option.
        reference: spec.reference ? arg || null : null,
        caption,
        optionsDone: false,
        captionDone: caption.length > 0 && spec.caption === "arg",
        wantsBody: spec.caption === "body" || (spec.caption === "both" && caption.length === 0),
      });
      continue;
    }

    // ---------- Ouverture d'un bloc de code ordinaire ----------
    const code = CODE_OPEN.exec(line);
    if (code) {
      pushOpaque(code[1]);
      continue;
    }

    // ---------- Corps d'une directive ouverte ----------
    if (frame) {
      if (!frame.optionsDone) {
        const enumOpt = ENUMERATED.exec(line);
        if (enumOpt) {
          const v = enumOpt[1].toLowerCase();
          // `:enumerated:` nu vaut true, comme un drapeau.
          frame.wantsNumber = v === "" ? true : !/^(false|off|no|0)$/.test(v);
          continue;
        }
        const label = LABEL_OPTION.exec(line);
        if (label) {
          frame.label = label[1];
          continue;
        }
        if (ANY_OPTION.test(line)) continue;
        frame.optionsDone = true;
        settleNumber(frame);
        if (line.trim() === "") continue;
        // Pas une option : on est dans le corps, on retombe plus bas.
      }

      // `\label{}` à l'intérieur d'un bloc {math}
      if (frame.spec.kind === "eq" && !frame.label) {
        const tex = TEX_LABEL.exec(line);
        if (tex) {
          frame.label = tex[1];
          continue;
        }
      }

      if (frame.wantsBody && !frame.captionDone) {
        if (line.trim() === "") {
          if (frame.caption.length) frame.captionDone = true;
        } else {
          frame.caption.push(line.trim());
        }
      }
      continue;
    }

    // ---------- Équations hors directive ----------
    const begin = MATH_ENVS.some((env) => line.includes(`\\begin{${env}}`));
    const end = MATH_ENVS.some((env) => line.includes(`\\end{${env}}`));
    const dollars = (line.match(/\$\$/g) ?? []).length;

    if (mathLine === null && (begin || dollars > 0)) {
      mathLine = lineNo;
      //const number = nextNumber("eq");
      const number = enabled.math ? (counters.eq = (counters.eq ?? 0) + 1) : null;
      
      const inlineLabel = TEX_LABEL.exec(line)?.[1] ?? null;
      byLine.set(mathLine, { number, label: inlineLabel, kind: "eq", title: "" });
      if (inlineLabel) byLabel.set(inlineLabel, { number, kind: "eq", title: "", line: mathLine });
      if (dollars >= 2) mathLine = null; // $$ … $$ sur une seule ligne
      continue;
    }

    if (mathLine === null) continue;

    const tex = TEX_LABEL.exec(line);
    if (tex) {
      const entry = byLine.get(mathLine);
      entry.label = tex[1];
      byLabel.set(tex[1], { number: entry.number, kind: "eq", title: "", line: mathLine });
    }

    if (end || dollars > 0) mathLine = null;
  }

  // Blocs non refermés en fin de document : on enregistre quand même.
  while (stack.length) closeTop();

  // ---------- Une solution hérite du numéro de son exercice ----------
  for (const info of byLabel.values()) {
    if (info.kind !== "solution" || !info.reference) continue;
    const source = byLabel.get(info.reference);
    if (source) info.number = source.number;
  }

  // ---------- Sections ----------
  const sectionLabelLines = scanSectionLabelLines(fullText);
  for (const [label, headingLine] of sectionLabelLines.entries()) {
    const headingInfo = headingMap?.byLine.get(headingLine);
    if (!headingInfo) continue;
    byLabel.set(label, {
      number: headingMap.active ? headingInfo.number : null,
      kind: "sec",
      title: headingInfo.text,
      line: headingLine,
    });
  }

  const targets = {};
  for (const [label, info] of byLabel.entries()) {
    targets[label] = { label, kind: info.kind, title: info.title, number: info.number };
  }

  return { byLine, byLabel, targets };
}

