const REF_DEF_RE = /^\[([^\]]+)\]:\s*(\S+)(?:\s+(?:"([^"]*)"|'([^']*)'))?\s*$/;

/** Pré-scan global : collecte toutes les définitions [ref]: url "title" du document. */
export function scanReferenceLinks(fullText) {
  const refDefs = new Map(); // label normalisé (lowercase, espaces réduits) -> { url, title }
  const lines = fullText.split("\n");

  for (const line of lines) {
    const match = line.match(REF_DEF_RE);
    if (!match) continue;
    const label = match[1].trim().toLowerCase().replace(/\s+/g, " ");
    const url = match[2];
    const title = match[3] ?? match[4] ?? null;
    refDefs.set(label, { url, title });
  }

  return refDefs;
}

export function markdownItRefLinkDefSkip(md) {
  md.block.ruler.before("paragraph", "ref_link_def_skip", (state, startLine, endLine, silent) => {
    const lineText = state.src.slice(state.bMarks[startLine], state.eMarks[startLine]);
    if (!REF_DEF_RE.test(lineText)) return false;
    if (!state.env.refDefs) return false;

    if (silent) return true;
    state.line = startLine + 1;
    return true;
  });
}

/** Règle inline : intercepte [texte][ref] avant la règle native, résout via refDefs global. */
export function markdownItRefLinks(md) {
  md.inline.ruler.before("link", "ref_link_global", (state, silent) => {
    if (state.src.charCodeAt(state.pos) !== 0x5b /* [ */) return false;

    const refDefs = state.env.refDefs;
    if (!refDefs || refDefs.size === 0) return false;

    const src = state.src.slice(state.pos);

    // Cas 1 : [texte][ref] ou [texte][] (label explicite ou implicite = texte)
    let match = /^\[([^\]]+)\]\[([^\]]*)\]/.exec(src);
    let textPart, label;

    if (match) {
      textPart = match[1];
      const explicitLabel = match[2];
      label = (explicitLabel || textPart).trim().toLowerCase().replace(/\s+/g, " ");
    } else {
      // Cas 2 : [ref] seul (shortcut reference), à condition de ne pas être suivi de "(" (lien inline classique)
      match = /^\[([^\]]+)\]/.exec(src);
      if (!match) return false;
      const afterMatch = src.slice(match[0].length);
      if (afterMatch.startsWith("(")) return false; // laisse la règle native "link" gérer [texte](url)
      if (afterMatch.startsWith("[")) return false; // c'est en fait le cas 1, déjà géré au-dessus si ça matchait

      textPart = match[1];
      label = textPart.trim().toLowerCase().replace(/\s+/g, " ");
    }

    const def = refDefs.get(label);
    if (!def) return false; // label inconnu : on laisse le texte brut tel quel

    if (silent) return true;

    const openTok = state.push("link_open", "a", 1);
    openTok.attrSet("href", def.url);
    if (def.title) openTok.attrSet("title", def.title);

    const textTok = state.push("text", "", 0);
    textTok.content = textPart;

    state.push("link_close", "a", -1);

    state.pos += match[0].length;
    return true;
  });
}