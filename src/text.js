import { computed, effect, signal } from "@preact/signals";
import markdownIt from "markdown-it";
import markdownitDocutils, { directivesDefault } from "markdown-it-docutils";
import newDirectives from "./markdown/markdownDirectives";
import { titledAdmonitions } from "./markdown/markdownDirectives"; // au lieu de l'ancien import figé
// import titledAdmonitions from "./markdown/markdownTitledAdmonitions";
import { markdownReplacer, useCustomDirectives, useCustomRoles, mystComments } from "./markdown/markdownReplacer";
import markdownMermaid from "./markdown/markdownMermaid";
import markdownSourceMap from "./markdown/markdownSourceMap";
import { checkLinks } from "./markdown/markdownLinks";
import { colonFencedBlocks } from "./markdown/markdownFence";
import { markdownItMapUrls, overloadMapUrl } from "./markdown/markdownUrlMapping";
import { backslashLineBreakPlugin } from "./markdown/markdownLineBreak";
import IMurMurHash from "imurmurhash";
import purify from "dompurify";
import { StateEffect } from "@codemirror/state";
import hljs from "highlight.js/lib/core";
import yamlHighlight from "highlight.js/lib/languages/yaml";
import { markdownCheckboxes } from "./markdown/markdownCheckboxes";
import { criticMarkup } from "./markdown/markdownCriticMarkup";
import { markdownFrontmatter } from "./markdown/markdownFrontmatter";
import markdownItMath, { scanTargets } from "./markdown/markdownMath";
import { extractFrontmatter } from "./markdown/frontmatterUtils";
import { updateMathMacros, getMacrosSignature } from "./markdown/markdownMath";
import { numberHeadings, flattenToLineMap } from "./utils/headingNumbering";
import markdownItHeadings from "./markdown/markdownHeadings";
import { getSectionLabelsSignature, getNumberingConfig } from "./markdown/markdownMath";
import { scanFootnotes, markdownItFootnoteRefs, markdownItFootnoteDefs, renderFootnotesSection } from "./markdown/markdownFootnotes";
import {
  ensureBibliographyLoaded,
  scanCitations,
  markdownItCitations,
  markdownItBibliographyMarker,
  renderBibliographySection,
  getBibEntries,
  Cite,
} from "./markdown/bibliography";
import { invalidatePreviewMapCache } from "./utils/previewPopup";
import { moveSectionInText, flattenHeadingsWithLines, computeSectionRange } from "./utils/sectionReorder";
import { scanReferenceLinks, markdownItRefLinks } from "./markdown/markdownRefLinks";

window.moveSectionInText = moveSectionInText;
window.flattenHeadingsWithLines = flattenHeadingsWithLines;
window.testMoveSectionInText = moveSectionInText;
window.testFlattenHeadingsWithLines = flattenHeadingsWithLines;
window.testComputeSectionRange = computeSectionRange;
// ou directement en copiant la fonction dans un scratch pad



export const markdownUpdatedEffect = StateEffect.define();
/** Re-project Inline widgets after external data changes (transforms that don't touch the doc text). */
export const inlineRefreshEffect = StateEffect.define();
let timing_debug = false;


hljs.registerLanguage("yaml", yamlHighlight);


// Utils 
export const lineStarts = (text) => {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) starts.push(i + 1);
  return starts;
};

/** Numéro de ligne (1-based) pour un offset, en O(log n). */
export const lineAtOffset = (starts, offset) => {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= offset) lo = mid; else hi = mid - 1;
  }
  return lo + 1;
};

/** This class stores the document text and renders the Markdown in the Preview */
export class TextManager {
  /** @type {number} - pending requestAnimationFrame id, 0 when no render is scheduled */
  #renderFrame = 0;
  /** @type {{ useCache: boolean, staleInputs: Set<string> } | null} */
  #renderPending = null;

  constructor({ initialText, editorView, cache, options, userSettings, headings, cleanups }) {

    this.headings = headings;
    this.text = signal(initialText.peek());
    this.lineMap = new Map();
    this.chunks = [];
    this.editorView = editorView;
    this.preview = signal(null);
    this.options = options;
    this.userSettings = userSettings;
    this.md = computed(() => {
      const md = markdownIt({
        breaks: true,
        linkify: true,
        html: true,
        highlight: (str, lang) => {
          if (lang && hljs.getLanguage(lang)) {
            try {
              const v = hljs.highlight(str, { language: lang }).value;
              return v;
            } catch (err) {
              console.error(`Error while highlighting ${lang}: ${err}`);
            }
            return md.utils.escapeHtml(str);
          }
        },
      })
        //.use(markdownitDocutils, { directives: { ...directivesDefault, ...newDirectives } })
        //.use(markdownitDocutils, { directives: finalDirectives })
        .use(markdownitDocutils, { directives: { ...directivesDefault, ...titledAdmonitions, ...newDirectives } })
        .use(markdownReplacer(options.transforms.value, cache.transform))
        .use(mystComments)
        .use(useCustomRoles(options.customRoles.value, cache.transform))
        .use(useCustomDirectives(options.customDirectives.value, cache.transform))
        .use(markdownMermaid, { lineMap: this.lineMap, parent: options.parent, theme: options.mermaidTheme.value })
        .use(markdownItMath, this.options.id.value)
        .use(markdownSourceMap)
        .use(markdownItHeadings)
        .use(markdownItFootnoteDefs)
        .use(markdownItFootnoteRefs)
        .use(markdownItBibliographyMarker)
        .use(markdownItCitations)
        .use(markdownItRefLinks)
        .use(checkLinks)
        .use(colonFencedBlocks)
        ////.use(markdownItMapUrls, options.mapUrl.value)
        .use(markdownItMapUrls, overloadMapUrl(cache.transform)(options.mapUrl.value))
        .use(markdownCheckboxes)
        //.use(criticMarkup)
        .use(markdownFrontmatter);
        

      if (options.backslashLineBreak.value) md.use(backslashLineBreakPlugin);
      userSettings.value.filter((s) => s.enabled && s.markdown).forEach((s) => md.use(s.markdown));

      // Customize detecting links
      md.linkify.set({ fuzzyLink: false });

      return md;
    });
    // Doc text and async transform settles share one rAF pipeline (Preview + Inline refresh).
    // Every signal renderText reads has to be touched here: the render itself runs in a rAF
    // callback, where reads aren't tracked, so these are what actually schedule it.
    effect(() => {
      this.text.value;
      this.md.value;
      this.preview.value;
      this.editorView.value;
      this.options.mode.value;
      this.scheduleRender();
    });
    effect(() => (window.myst_editor[options.id.value].text = this.text.value));
    effect(() => this.observePreview());

    const unsubscribe = cache.transform.onChange((input) => this.scheduleRender({ staleInput: input }));
    cleanups?.push(() => {
      if (this.#renderFrame) clearTimeout(this.#renderFrame);
      // if (this.#renderFrame) cancelAnimationFrame(this.#renderFrame);
      this.#renderFrame = 0;
      this.#renderPending = null;
      unsubscribe();
    });
  }

  /**
   * Coalesce Preview + Inline refreshes onto the next animation frame.
   * @param {{ useCache?: boolean, staleInput?: string }} [opts]
   */
  scheduleRender({ useCache = true, staleInput } = {}) {
    if (timing_debug) console.log("scheduleRender appelé, useCache:", useCache, "staleInput:", staleInput, new Error().stack.split("\n")[2]);
 
    if (!this.#renderPending) this.#renderPending = { useCache: true, staleInputs: new Set() };
    this.#renderPending.useCache = this.#renderPending.useCache && useCache;
    if (staleInput) this.#renderPending.staleInputs.add(staleInput);

    if (this.#renderFrame) return;
    //this.#renderFrame = requestAnimationFrame(() => {
    this.#renderFrame = setTimeout(() => {
      this.#renderFrame = 0;
      const { useCache: cached, staleInputs } = this.#renderPending;
      this.#renderPending = null;
      const stale = staleInputs.size > 0 ? (chunkText) => [...staleInputs].some((input) => chunkText.includes(input)) : undefined;
      // Chunks first so Inline's refresh projects the same cached HTML Preview uses.
      this.renderText(cached, false, stale);
      this.editorView.value?.dispatch({ effects: inlineRefreshEffect.of(null) });
    // });
    }, 50);
  }

  /** @param {(chunkText: string) => boolean} [stale] - re-render these chunks even when cached */
  renderText(useCache = true, force = false, stale = undefined) {
    if (!this.editorView.value && !force) {
      this.lastMode = this.options.mode.value;
      return;
    }
    const newMode = this.lastMode && this.options.mode.value !== this.lastMode;
    const cache = (!this.lastMd || this.lastMd == this.md.value) && !newMode && useCache;
    const chunkLookup = cache
      ? this.chunks.reduce((lookup, chunk) => (stale?.(chunk.text) ? lookup : { ...lookup, [chunk.hash]: { html: chunk.html, oldId: chunk.id } }), {})
      : {};
    const newChunks = this.splitTextIntoChunks(chunkLookup);

    const previewVisible = ["Both", "Preview"].includes(this.options.mode.value) || force;
    if (this.preview.value && previewVisible) {
      const chunkEls =
        this.chunks.length == newChunks.length ? newChunks.map((c) => this.preview.value.querySelector(`html-chunk#html-chunk-${c.id}`)) : [];

      if (this.chunks.length != newChunks.length || chunkEls.some((el) => !el)) {
        const toRemove = [...this.preview.value.childNodes].filter((c) => !c.classList || !c.classList.contains("cm-previewFocus"));
        toRemove.forEach((c) => this.preview.value.removeChild(c));
        this.preview.value.innerHTML += newChunks.map((c) => `<html-chunk id="html-chunk-${c.id}">${c.html}</html-chunk>`).join("");
      } else {
        // Patch only chunks whose rendered html changed (covers transform output with unchanged source).
        newChunks.forEach((chunk, idx) => {
          if (chunk.html !== this.chunks[idx].html) chunkEls[idx].innerHTML = chunk.html;
        });
      }
    }

    this.foldSections();

    this.chunks = newChunks;
    this.lastMd = this.md.value;
    this.lastMode = this.options.mode.value;
    invalidatePreviewMapCache(this.options.id.value);
  }

  /**
   * Fresh, uncached render after external data changed (transforms that don't touch the doc text).
   * Goes through the same frame as everything else, so it can safely be called from anywhere -
   * including from within a CodeMirror update, where dispatching synchronously would throw.
   */
  rerender() {
    this.scheduleRender({ useCache: false });
  }

  /** Makes every heading of the preview foldable and hides the blocks under the folded ones. */
  foldSections() {
    const useMarker = this.options.collapsibleHeadingMarker.value;
    let foldedAt = null;
    // Blocks are walked across chunks, since the section of an `h1`-`h3` heading spans whole chunks.
    for (const block of this.preview.value.querySelectorAll(":scope > html-chunk > *")) {
      // Everything which is not a heading counts as deeper than one, so it belongs to the open fold.
      const level = /^H[1-6]$/.test(block.tagName) ? parseInt(block.tagName[1]) : 7;
      const folded = foldedAt !== null && level > foldedAt;
      block.classList.toggle("myst-folded", folded);
      if (folded || level === 7) continue;

      // `data-fold` survives in chunks which were not rerendered, which keeps this idempotent.
      if (!block.dataset.fold) {
        const marked = useMarker && FOLD_MARKER.test(block.textContent);
        if (marked) stripFoldMarker(block);
        block.dataset.fold = marked ? "closed" : "open";
        // A real element, unlike a pseudo element, can be the target of a click.
        block.insertAdjacentHTML("afterbegin", '<span class="myst-fold-arrow"></span>');
      }
      foldedAt = block.dataset.fold === "closed" ? level : null;
    }
  }

  /** Returns whether the click landed on the fold arrow of a heading. */
  toggleFoldOnClick(ev) {
    const heading = ev.target.closest?.(".myst-fold-arrow")?.parentElement;
    if (!heading) return false;
    heading.dataset.fold = heading.dataset.fold === "closed" ? "open" : "closed";
    this.foldSections();
    return true;
  }

  observePreview() {
    if (!this.preview.value) return;
    const imageObserver = new ResizeObserver(() => {
      // https://developer.mozilla.org/en-US/docs/Web/API/ResizeObserver#observation_errors
      // Using this without requestAnimationFrame caused some observation errors while rendering
      requestAnimationFrame(() => this.editorView.value.dispatch({ effects: markdownUpdatedEffect.of(true) }));
    });
    const observer = new MutationObserver(() => {
      this.editorView.value.dispatch({ effects: markdownUpdatedEffect.of(true) });
      this.preview.value.querySelectorAll("img").forEach((i) => imageObserver.observe(i));
    });
    observer.observe(this.preview.value, { childList: true, subtree: true });

    return () => {
      imageObserver.disconnect();
      observer.disconnect();
    };
  }



  splitTextIntoChunks(chunkLookup = {}) {
    
    if (timing_debug) {const _t0 = performance.now();}
    const fmResult = extractFrontmatter(this.text.value);
    updateMathMacros(this.options.id.value, fmResult?.frontmatter);
    const macrosSignature = getMacrosSignature(this.options.id.value);
    if (timing_debug) console.log("frontmatter+macros:", (performance.now() - _t0).toFixed(2), "ms");
    //
    //const refsKindLabel = getKindLabel(fmResult?.frontmatter)
    const { kindLabel, numberingEnabled } = getNumberingConfig(fmResult?.frontmatter);

    // bibliography

    const bibliographyPath = fmResult?.frontmatter?.bibliography;
    const citationStyle = fmResult?.frontmatter?.["citation-style"] || "numeric";
    const citationTemplate = fmResult?.frontmatter?.["citation-template"];
    const numberingFrontmatter = fmResult?.frontmatter?.["numbering"];
    const numberingSectionsFrontmatter = fmResult?.frontmatter?.["numbering"]?.["headings"];
    const numberingSignature = JSON.stringify(numberingFrontmatter)

    const numberingSetting = this.userSettings.value.find(
      s => s.id === "number-headers"
    );

    if (numberingSectionsFrontmatter !== undefined && numberingSetting) {
      numberingSetting.enabled = numberingSectionsFrontmatter;
    }
    if (timing_debug) {const _t1 = performance.now();}
    const refDefs = scanReferenceLinks(this.text.value);
    const refDefsSignature = [...refDefs.entries()].map(([k, v]) => `${k}:${v.url}`).join("|");
    if (timing_debug) console.log("scanReferenceLinks+macros:", (performance.now() - _t1).toFixed(2), "ms");

    ensureBibliographyLoaded(this.options.id.value, bibliographyPath, () => this.options.getBibliographyDirectory.value?.(), () => this.rerender());
    if (timing_debug) {const _t2 = performance.now();}
    const { citeMap } = scanCitations(this.text.value, getBibEntries(this.options.id.value), citationStyle);
    
    const citationsSignature = [...citeMap.entries()].map(([k, v]) => `${k}:${v.number}:${v.entry?.year}`).join("|");
    if (timing_debug) console.log("scanCitations:", (performance.now() - _t2).toFixed(2), "ms");
    
    // for headings numbering
    if (timing_debug) {const _t3 = performance.now();}
    const numberingSectionsActive = this.userSettings.value.find((s) => s.id === "number-headers")?.enabled ?? false;
    const numberedHeadings = numberHeadings(this.headings.value);
    const headingByLine = flattenToLineMap(numberedHeadings, this.text.value);
    const headingMap = { byLine: headingByLine, active: numberingSectionsActive };
    if (timing_debug) console.log("headings, count:", this.headings.value.length, "temps:", (performance.now() - _t3).toFixed(2), "ms");

    if (timing_debug) {const _t4 = performance.now();}
    const { byLine, byLabel, targets } = scanTargets(this.text.value, numberingEnabled, headingMap);
    const refMap = { byLine, byLabel };
    if (timing_debug) console.log("scanTargets:", (performance.now() - _t4).toFixed(2), "ms");

    const sectionLabelsSignature = getSectionLabelsSignature(byLabel);

    if (timing_debug) {const _t5 = performance.now();}
    const { footnoteMap } = scanFootnotes(this.text.value);
    const footnotesSignature = [...footnoteMap.entries()].map(([l, i]) => `${l}:${i.number}:${i.content}`).join("|");
    if (timing_debug) console.log("scanFootnotes:", (performance.now() - _t5).toFixed(2), "ms");

    this.refMap = refMap; // exposed for external use (e.g. label resolution -> line in Inline mode)
    this.headingMap = headingMap; // same, for headings if necessary
    this.citeMap = citeMap;
    this.footnoteMap = footnoteMap;
    this.citationTemplate = citationTemplate;
    this.kindLabel = kindLabel;
    this.numberingEnabled = numberingEnabled;
    this.bibArray = getBibEntries(this.options.id.value); //getBibEntries: () => getBibEntries(options.id.value)


    if (timing_debug) {const _t6 = performance.now();}
    let renderMs = 0
    let sanitizeMs = 0
    let cacheHits = 0
    const realChunks = this.text.value
      .split(/(?=\n#{1,3} )/g)
      .reduce((chunks, textChunk) => {
        const lastChunkIdx = chunks.length - 1;
        const lastChunk = chunks[lastChunkIdx];

        let startLine = 1;
        if (lastChunk) {
          if (lastChunkIdx == 0) startLine = lastChunk.startLine + lastChunk.text.split("\n").length;
          else startLine = lastChunk.startLine + lastChunk.text.trimLeft().split("\n").length;
        }
        const endLine = startLine + textChunk.trimStart().split("\n").length - 1;

        const MAX_CHUNK = 50_000;  // That's to limit chunks' size
        const fenceRegex = /^[`:~]{3}/gm;
        const unbalanced = countOccurences(lastChunk?.text, fenceRegex) % 2 != 0;
        if (unbalanced && lastChunk && lastChunk.text.length < MAX_CHUNK) {
          chunks[lastChunkIdx] = { text: lastChunk.text + textChunk, startLine: lastChunk.startLine, endLine };
        } else {
          chunks.push({ text: textChunk, startLine, endLine });
        }
        /*const fenceRegex = /^[`:~]{3}/gm;
        if (countOccurences(lastChunk?.text, fenceRegex) % 2 != 0) {
          chunks[lastChunkIdx] = { text: lastChunk.text + textChunk, startLine: lastChunk.startLine, endLine };
        } else {
          chunks.push({ text: textChunk, startLine, endLine });
        }*/
        return chunks;
      }, [])
      .map(({ text, startLine, endLine }, chunkId) => {
        const headingSignature = numberingSectionsActive ? "on" : "off";

        const hash = new IMurMurHash(
        //  `${text}\0${chunkId}\0${startLine}\0${macrosSignature}\0${headingSignature}\0${sectionLabelsSignature}\0${footnotesSignature}\0${citationsSignature}\0${numberingFrontmatter}`,
         `${text}\0${chunkId}\0${startLine}\0${macrosSignature}\0${headingSignature}\0${sectionLabelsSignature}\0${footnotesSignature}\0${citationsSignature}\0${numberingSignature}\0${refDefsSignature}`,
        42,
        ).result();
        
        if (!(hash in chunkLookup)) {
          for (let l = startLine; l <= endLine; l++) {
            this.lineMap.delete(l);
          }
        }

      

        let html = chunkLookup[hash]?.html;
        if (html === undefined) {
          if (timing_debug) {const _r0 = performance.now();}
          const rendered = this.md.value.render(text, { chunkId,
                      startLine,
                      lineMap: this.lineMap,
                      view: this.editorView.value,
                      refMap,
                      docutils: { targets },
                      headingMap,
                      footnoteMap,
                      citeMap, 
                      citationStyle,
                      citationTemplate,
                      kindLabel,
                      numberingEnabled,
                      refDefs, });
          if (timing_debug) {const _r1 = performance.now();}
          html = sanitize(rendered);
          if (timing_debug) {
            renderMs += _r1 - _r0;
            sanitizeMs += performance.now() - _r1;}
        } else {
          cacheHits++;
        }
        
        /* const html =
          chunkLookup[hash]?.html ||
          sanitize(
            this.md.value.render(text, {
              chunkId,
              startLine,
              lineMap: this.lineMap,
              view: this.editorView.value,
              refMap,
              docutils: { targets },
              headingMap,
              footnoteMap,
              citeMap, 
              citationStyle,
              citationTemplate,
              kindLabel,
              numberingEnabled,
              refDefs,
            }),
          ); */

        return { text, hash, id: chunkId, html, oldId: chunkLookup[hash]?.oldId, startLine, endLine };
      });

      if (timing_debug) console.log(`chunks: ${realChunks.length}, hits: ${cacheHits}, render: ${renderMs.toFixed(0)}ms, sanitize: ${sanitizeMs.toFixed(0)}ms`);
      if (timing_debug) console.log("splitAndRender:", (performance.now() - _t6).toFixed(2), "ms");

    if (footnoteMap.size > 0) {
      const footnotesHash = `footnotes-${footnotesSignature}`;
      const footnotesHtml = chunkLookup[footnotesHash]?.html || renderFootnotesSection(footnoteMap, this.md.value);
      const lastChunk = realChunks[realChunks.length - 1];
      realChunks.push({
        text: "",
        hash: footnotesHash,
        id: realChunks.length,
        html: footnotesHtml,
        oldId: chunkLookup[footnotesHash]?.oldId,
        startLine: (lastChunk?.endLine ?? 0) + 1,
        endLine: (lastChunk?.endLine ?? 0) + 1,
      });
    }

    if (citeMap.size > 0) {
      const alreadyPlaced = realChunks.some((c) => c.html.includes('class="bibliography"'));
      if (!alreadyPlaced) {
        const bibHash = `bibliography-${citationsSignature}`;
        const bibHtml = chunkLookup[bibHash]?.html || renderBibliographySection(citeMap, citationStyle, citationTemplate, this.md.value);
        const lastChunk = realChunks[realChunks.length - 1];
        realChunks.push({
          text: "",
          hash: bibHash,
          id: realChunks.length,
          html: bibHtml,
          oldId: chunkLookup[bibHash]?.oldId,
          startLine: (lastChunk?.endLine ?? 0) + 1,
          endLine: (lastChunk?.endLine ?? 0) + 1,
        });
      }
    }

    return realChunks;
}


  shiftLineMap(update) {
    if (update.startState.doc.lines === update.state.doc.lines) return;
    let shiftStart = 0;
    let shiftAmount = 0;
    update.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
      const startLine = update.startState.doc.lineAt(fromA).number;
      const endLine = update.startState.doc.lineAt(toA).number;
      const startLineB = update.state.doc.lineAt(fromB).number;
      const endLineB = update.state.doc.lineAt(toB).number;

      shiftStart = endLine;
      if (startLine === endLine) {
        shiftAmount = endLineB - startLineB;
      } else {
        shiftAmount = -(endLine - startLine);
      }
    });

    const newMap = new Map(this.lineMap);
    for (const [line, id] of this.lineMap.entries()) {
      if (line < shiftStart) continue;
      if (id === newMap.get(line)) {
        newMap.delete(line);
      }
      newMap.set(line + shiftAmount, id);
    }
    this.lineMap = newMap;
  }

  async copy() {
    this.renderText(true, true);
    const html = this.chunks.map((c) => c.html).join("\n");
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    doc.querySelectorAll("[data-line-id]").forEach((n) => n.removeAttribute("data-line-id"));
    // This removes spans added for source mapping purposes.
    doc.querySelectorAll("span").forEach((n) => {
      if (n.attributes.length === 0) {
        n.insertAdjacentHTML("afterend", n.innerHTML);
        n.remove();
      }
    });
    doc.querySelectorAll("[data-remove]").forEach((n) => n.remove());
    // The cached chunk HTML still has the markers, they are only stripped from the preview DOM.
    if (this.options.collapsibleHeadingMarker.value) doc.querySelectorAll("h1, h2, h3, h4, h5, h6").forEach(stripFoldMarker);
    const sanitized = doc.body.innerHTML;

    await navigator.clipboard.write([
      new ClipboardItem({
        "text/plain": new Blob([sanitized], { type: "text/plain" }),
        "text/html": new Blob([sanitized], { type: "text/html" }),
      }),
    ]);
  }
}

const countOccurences = (str, pattern) => (str?.match(pattern) || []).length;

/** Trailing marker which makes a heading start folded, e.g. `## Section (^)`. */
export const FOLD_MARKER = /\s*\(\^\)\s*$/;

/** Edits the trailing text node, not `innerHTML`, to leave source mapping spans untouched. */
export function stripFoldMarker(heading) {
  let node = heading;
  while (node.lastChild) node = node.lastChild;
  if (node.nodeType === Node.TEXT_NODE) node.data = node.data.replace(FOLD_MARKER, "");
}

export function sanitize(unsafeHTML) {
  return purify.sanitize(unsafeHTML, {
    ADD_TAGS: ["foreignobject", "iframe"],
    ADD_ATTR: ["dominant-baseline", "target"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|ftp|mailto|tel|blob|asset):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
  });
}
