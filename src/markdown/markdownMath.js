import texmath from "markdown-it-texmath";
import katex from "katex";
import { getLineById } from "./markdownSourceMap";
import { kindLabelsFrom, numberedByNameFrom } from "./scanTargets";
import { getLabelledDirectives } from "../config";


const LABELLED_DIRECTIVES = getLabelledDirectives();
export const katexMacros = {};

// --- multitabs
const katexMacrosByEditor = new Map(); // editorId -> objet macros mutable

export function getKatexMacros(editorId) {
  if (!katexMacrosByEditor.has(editorId)) {
    katexMacrosByEditor.set(editorId, {});
  }
  return katexMacrosByEditor.get(editorId);
}

export function updateMathMacros(editorId, frontmatter) {
  const macros = getKatexMacros(editorId);
  for (const key in macros) delete macros[key];
  const mathMacros = frontmatter?.math;
  if (mathMacros && typeof mathMacros === "object") {
    Object.assign(macros, mathMacros);
  }
}

export function getMacrosSignature(editorId) {
  return JSON.stringify(getKatexMacros(editorId));
}

export function disposeEditorMacros(editorId) {
  katexMacrosByEditor.delete(editorId);
}
// ---




function findNearestTableEntry(byLine, absoluteLine) {
  let best = null;
  let bestLine = -Infinity;
  for (const [line, entry] of byLine.entries()) {
    if (entry.kind !== "table") continue;
    if (line <= absoluteLine && line > bestLine) {
      bestLine = line;
      best = entry;
    }
  }
  return best;
}


export function getNumberingConfig(frontmatter) {
  const defaultKindLabel = kindLabelsFrom(LABELLED_DIRECTIVES);
  //const defaultNumbered = numberedByKindFrom(LABELLED_DIRECTIVES);
  const defaultNumbered = numberedByNameFrom(LABELLED_DIRECTIVES);

  const numbering = frontmatter?.numbering ?? {};

  const getEntry = (singular, plural) => numbering[singular] ?? numbering[plural];

  const getTemplate = (singular, plural, fallback) => {
    const entry = getEntry(singular, plural);
    return typeof entry === "object" && entry?.template ? entry.template.replace("%s", "").trim() : fallback;
  };


  const getEnabled = (singular, plural, fallback = true) => {
    const entry = getEntry(singular, plural);
    if (typeof entry === "boolean") return entry;
    return fallback;
  };

/** Frontmatter key for a kind: derived from the label, lowercase. */
  const keysFor = (kind) => {
    const singular = (defaultKindLabel[kind] ?? kind).toLowerCase();
    return [singular, `${singular}s`];
  };

  const kindLabel = {};
  const numberingEnabled = {};

  for (const [name, spec] of Object.entries(LABELLED_DIRECTIVES)) {
    if (!spec.kind) continue;
    const singular = (spec.fmKey ?? spec.label ?? name).toLowerCase();
    const plural = `${singular}s`;
    kindLabel[name] = getTemplate(singular, plural, spec.label ?? name);
    numberingEnabled[name] = getEnabled(singular, plural, defaultNumbered[name]);
  }

  for (const [name, spec] of Object.entries(LABELLED_DIRECTIVES)) {
    if (!spec.kind) continue;
    numberingEnabled[spec.kind] ||= numberingEnabled[name];
    kindLabel[spec.kind] ??= kindLabel[name];
  }

// The sections do not come from a directive.
  kindLabel.sec = getTemplate("section", "sections", "Section");
  numberingEnabled.sec = numbering.headings ?? true;

  return { kindLabel, numberingEnabled };
}

export function refDisplayText(info, state) {
  // for links references like [](#label)
  const kindLabel = state.env?.kindLabel ?? {};
  const numberingEnabled = state.env?.numberingEnabled ?? {};

  const currentLabel = kindLabel[info.name] ?? kindLabel[info.kind] ?? info.kind;
  // const currentLabel = kindLabel[info.kind] ?? info.kind;
  const isNumberingEnabled = numberingEnabled[info.kind] ?? false;

  // Numbering explicitly disabled
  if (!isNumberingEnabled) {
    return `${currentLabel} ??`;
  }

  // No number available
  if (info.number == null || info.number === "") {
    return info.title + "??" || `${currentLabel} ??`;
  }

  return info.kind === "eq"
    ? `(${info.number})`
    : `${currentLabel} ${info.number}`;
}



const markdownItMath = (md, editorId) => {
  const macros = getKatexMacros(editorId);
  md.use(texmath, {
    engine: katex,
    delimiters: ['dollars', 'brackets', 'beg_end'],
    katexOptions: { throwOnError: false, macros },
  });


/*const markdownItMath = (md) => {
  md.use(texmath, {
    engine: katex,
    delimiters: ['dollars', 'brackets', 'beg_end'], // $...$ inline, $$...$$ bloc
    outerSpace: true,
    katexOptions: {
      throwOnError: false, macros: katexMacros
    },
  });*/

  // Replace @label by Type (Equation/Figure/Table) number
  md.inline.ruler.before("text", "at_ref", (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x40 /* '@' */) return false;

    const match = /^@([a-zA-Z][\w:-]*)/.exec(state.src.slice(state.pos));
    if (!match) return false;

    const label = match[1];
    const refMap = state.env.refMap;
    if (!refMap) return false;

    const info = refMap.byLabel.get(label);
    if (!info) return false; // label inconnu : on laisse '@' intact (email, mention, etc.)

    if (silent) return true;

    const kindLabel = state.env?.kindLabel;
    const numberingEnabled = state.env?.numberingEnabled;

    // const kindLabel = { eq: "Equation", fig: "Figure", table: "Table", sec: "Section" }[info.kind] ?? info.kind;
    const currentLabel = kindLabel[info.name] ?? kindLabel[info.kind] ?? info.kind;
    // const currentLabel = kindLabel[info.kind] ?? info.kind;

    const linkTok = state.push("link_open", "a", 1);
    linkTok.attrSet("href", `#${label}`);
    linkTok.attrSet("data-preview", label);
    const textTok = state.push("text", "", 0);
    textTok.content = `${currentLabel} ${info.number ?? "??"}`;
    state.push("link_close", "a", -1);

    state.pos += match[0].length;
    return true;
  });


  const originalBlockRule = md.renderer.rules.math_block;

  md.renderer.rules.math_block = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  token.content = token.content.replace(/\\label\{eq:[^}]+\}\s*/g, "");

  const html = originalBlockRule(tokens, idx, options, env, self);
  if (!env.refMap) return html;
  //if (!env.numberingEnabled.eq) return html;

  let eqInfo;
  let sourceLineId = token.attrGet("data-line-id"); // conservé pour le report sur le <div>

  if (token.meta?.numbered) {
    const label = token.meta.label;
    const info = env.refMap.byLabel.get(label);
    eqInfo = info != null ? { number: info.number, label } : null;
  } else {
    const resolvedLine = sourceLineId ? getLineById(env.lineMap, sourceLineId) : null;
    eqInfo = resolvedLine != null ? env.refMap.byLine.get(resolvedLine) : null;
  }

  if (!eqInfo) return html;

    const anchorId = eqInfo.label || token.attrGet("id");
    const anchorAttr = anchorId ? ` id="${anchorId}"` : "";
    const lineIdAttr = sourceLineId ? ` data-line-id="${sourceLineId}"` : "";
    //if (!env.numberingEnabled.eq) {
    //  return `<div ${anchorAttr}${lineIdAttr}>${html}</div>`;
    //}
    const eqEnabled = env.numberingEnabled?.math ?? env.numberingEnabled?.eq;
    if (!eqEnabled) {
      return `<div${anchorAttr}${lineIdAttr}>${html}</div>`;
    }
    else { 
    return `<div class="eq-numbered"${anchorAttr}${lineIdAttr}>${html}<span class="eq-number">(${eqInfo.number})</span></div>`;
  }
};


/*  const originalParagraphOpen =
    md.renderer.rules.paragraph_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.paragraph_open = (tokens, idx, options, env, self) => {
    const html = originalParagraphOpen(tokens, idx, options, env, self);

    if (!env.refMap) return html;
     if (!env.numberingEnabled.fig) return html;

    //const token = tokens[idx-1];
    //token.content = token.content.replace(/^(([a-zA-Z][\w:-]*))=\s*$/gm, "");

    const prevToken = tokens[idx - 1];
    if (!prevToken || prevToken.type !== "figure_caption_open") return html;

    let openIdx = idx - 1;
    while (openIdx >= 0 && tokens[openIdx].type !== "figure_open") openIdx--;
    if (openIdx < 0) return html;

    const figToken = tokens[openIdx];
    const id = figToken.attrGet("data-line-id");
    const resolvedLine = id ? getLineById(env.lineMap, id) : null;
    const info = resolvedLine != null ? env.refMap.byLine.get(resolvedLine) : null;
    if (!info) return html;

    return html + `<span class="fig-number">Figure${info.number != null ? ` ${info.number}` : ""}: </span>`;
  };
*/

  md.core.ruler.after("inline", "auto_ref", (state) => {
    if (!state.env.refMap) return;

    state.tokens.forEach((blockToken) => {
      if (blockToken.type !== "inline" || !blockToken.children) return;

      for (let i = 0; i < blockToken.children.length; i++) {
        const tok = blockToken.children[i];
        if (tok.type !== "link_open") continue;

        const href = tok.attrGet("href") || "";
        if (!href.startsWith("#")) continue;

        const label = href.slice(1);
        let info = state.env.refMap.byLabel.get(label);
        if (!info) {
          // nonexistent reference
          info = {number: "??", kind: '', title: ''}
        }//continue; // no label... 

        tok.attrSet("data-preview", label); 

        const next = blockToken.children[i + 1];
        const isEmpty = next && next.type === "link_close";

        if (isEmpty) {
          // Empty link: we generate all the text, as before /!\ we lose the link
          const textToken = new state.Token("text", "", 0);
          textToken.content = refDisplayText(info, state);//info.kind === "fig" ? `Figure ${info.number}` : `(${info.number})`;
          blockToken.children.splice(i + 1, 0, textToken);
          i++;
        } else if (next && next.type === "text" &&
          (next.content.includes("{number}") || next.content.includes("%s"))) {

          // Link with explicit text containing {number} or %s:
          // we replace the placeholder with the number
          next.content = next.content
            .replace(/\{number\}/g, String(info.number))
            .replace(/%s/g, String(info.number));
        }
      }
    });
  });

  // External links: native tooltip with the target URL.
md.core.ruler.push("external_link_title", (state) => {
  state.tokens.forEach((blockToken) => {
    if (blockToken.type !== "inline" || !blockToken.children) return;

    for (const tok of blockToken.children) {
      if (tok.type !== "link_open") continue;

      const href = tok.attrGet("href") || "";
      if (!href || href.startsWith("#")) continue;   // ancres internes : déjà gérées par data-preview
      if (tok.attrGet("data-preview")) continue;     // déjà pris en charge par la popup
      if (tok.attrGet("title")) continue;            // [txt](url "titre") : on respecte l'auteur
      tok.attrSet("data-preview", `url:${href}`);
      // tok.attrSet("title", href);
    }
  });
});

 /*const originalTableOpen =
    md.renderer.rules.table_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.table_open = (tokens, idx, options, env, self) => {
    let html = originalTableOpen(tokens, idx, options, env, self);
    if (!env.refMap) return html;
     if (!env.numberingEnabled.table) return html;

    const token = tokens[idx];
    const absoluteLine = token.map ? token.map[0] + env.startLine - (env.chunkId !== 0 ? 1 : 0) : null;
    if (absoluteLine == null) return html;

    const info = findNearestTableEntry(env.refMap.byLine, absoluteLine);
    if (!info || !info.label) return html;

    // html = html.replace("<table", `<table id="${info.label}"`);
    html = html.replace("<table", `<table id="${info.label}"`);

    // Si aucune caption n'a été fournie, on en injecte une minimale nous-mêmes.
    const nextToken = tokens[idx + 1];
    if (!nextToken || nextToken.type !== "table_caption_open") {
      //html += `<caption class="table-number-only">Table ${info.number}</caption>`;
      html += `<caption class="table-number-only">Table${info.number != null ? ` ${info.number}` : ""}: </caption>`;
    }

    return html;
  };

  const originalTableCaptionOpen =
    md.renderer.rules.table_caption_open || ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.table_caption_open = (tokens, idx, options, env, self) => {
    const html = originalTableCaptionOpen(tokens, idx, options, env, self);
    if (!env.refMap) return html;

    let openIdx = idx;
    while (openIdx >= 0 && tokens[openIdx].type !== "table_open") openIdx--;
    if (openIdx < 0) return html;

    const tableToken = tokens[openIdx];
    const absoluteLine = tableToken.map ? tableToken.map[0] + env.startLine - (env.chunkId !== 0 ? 1 : 0) : null;
    const info = absoluteLine != null ? findNearestTableEntry(env.refMap.byLine, absoluteLine) : null;
    if (!info) return html;

    return html + `Table ${info.number}: `;
  };*/


  // Corrects the text displayed by {eq}label, overwritten locally by chunk (docutils internal bug)
  md.core.ruler.push("fix_ref_numbers", (state) => {
    if (!state.env.refMap) return;

    state.tokens.forEach((blockToken) => {
      if (blockToken.type !== "inline" || !blockToken.children) return;
      const children = blockToken.children;

      for (let i = 0; i < children.length; i++) {
        const tok = children[i];
        if (tok.type === "ref_open" && tok.meta?.label) {

          tok.attrSet("data-preview", tok.meta.label); // preview
          let info = state.env.refMap.byLabel.get(tok.meta.label);
          //if (!info) continue;
          let noInfo = null;
          if (!info) {
          // nonexistent reference
          noInfo = true; 
        }

          const textTok = children[i + 1];
          if (!textTok || textTok.type !== "text") continue;
          
          if (info) {
            if (tok.meta.kind === "eq") {
              textTok.content = `(${info.number})`;
            } else if (tok.meta.kind === "ref" && tok.meta.value) {
              // value contient le texte du lien à compléter par le titre
              textTok.content = tok.meta.value + ' ' + info.title
            } else if (tok.meta.kind === "cite" && tok.meta.value) {
              // value contient le texte du lien à compléter par le titre
              textTok.content = tok.meta.value + ' ' + info.title
            }
            else if (tok.meta.kind === "numref" && tok.meta.value) {
              // value contains the pattern "%s"/"{number}" already resolved locally by docutils;
              // we recalculate it ourselves with the correct overall number.
              textTok.content = tok.meta.value
                .replace(/%s/g, String(info.number))
                .replace(/\{number\}/g, String(info.number));
            }
          }
          else {
            textTok.content = "??";
          }
        }
      }
    });
  });
};



export default markdownItMath;