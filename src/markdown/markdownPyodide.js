/**
 * markdownPyodide.js — plugin markdown-it pour les cellules code-cell.
 *
 * Intercepte :
 *   1. Les tokens fence dont l'info commence par "code-cell" (syntaxe simple)
 *   2. Les divs .code-cell-host générés par CodeCellDirective (syntaxe directive)
 *
 * Dans les deux cas, génère un div placeholder que l'observateur MutationObserver
 * détecte pour appeler initCodeCell() depuis pyodideRunner.js.
 */

import { infoHasFold } from "./cellFold.js";
import IMurMurHash from "imurmurhash";
import { initCodeCell, cellCache, cellKey, OWNER_SEP, onCellExecuted, cellTrace } from "./pyodideRunner";
// `{eval}` asks the engine for the value of one expression. A runtime that
// does not declare `expressions` -- a kernel that is not Python -- would say
// so here rather than fail at the call.
import { runtime } from "./cellRuntime.js";
import { Role } from "markdown-it-docutils";

const HASH_SEED = 42;

// ─── Eval role cache ─────────────────────────────────────────────────────────

/**
 * Simple async-aware cache for {eval} role results.
 * A lightweight stand-alone cache (avoids importing TransformCache from
 * markdownReplacer.js which would create a circular dependency).
 */
export const evalCache = {
  _map: new Map(),
  /** Keys whose value is still shown but has to be computed again. */
  _stale: new Set(),
  /** Keys whose evaluation is in flight, so a second render does not ask twice. */
  _pending: new Set(),
  _listeners: new Set(),
  _epoch: 0,   // incremented on clear()/invalidate() to discard in-flight resolve() promises
  has(key) { return this._map.has(key); },
  get(key) { return this._map.get(key); },
  isStale(key) { return this._stale.has(key); },
  /**
   * Record a value, and tell the listeners only if it is not the one already
   * shown. A listener means a re-render of the whole document, so an answer
   * that confirms what is on screen has to stay silent.
   */
  set(key, value) {
    if (globalThis.mystralCellDebug) console.log("[eval] settled", JSON.stringify({ key, value }));
    const before = this._map.get(key);
    this._map.set(key, value);
    this._stale.delete(key);
    this._pending.delete(key);
    const same = before !== undefined && before?.kind === value?.kind && before?.value === value?.value;
    if (!same) this._listeners.forEach(fn => fn(key));
  },
  /**
   * Kick off async evaluation unless the value is current, or already being
   * computed. Captures the current epoch: if the cache is cleared or
   * invalidated before the promise settles, the result is discarded rather
   * than re-poisoning the cache.
   */
  resolve(key, promise, how = null) {
    if (how) this._how.set(key, how);
    if (this._pending.has(key)) return;
    if (this._map.has(key) && !this._stale.has(key)) return;
    this._pending.add(key);
    const epoch = this._epoch;
    const settle = (result) => {
      if (this._epoch !== epoch) {
        this._pending.delete(key);   // a newer pass owns this key now
        return;
      }
      this.set(key, result);
    };
    Promise.resolve(promise)
      .then(settle)
      .catch(err => settle({ kind: "error", value: String(err) }));
  },
  /**
   * How to compute each key again, remembered when it is first submitted.
   *
   * It is what lets a cell run re-evaluate the expressions without a render:
   * see `invalidate`.
   */
  _how: new Map(),
  /** Subscribe to results; returns an unsubscribe function. */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  },
  /**
   * Mark every result as needing a new evaluation, without throwing away what
   * is on screen.
   *
   * This is what a cell run calls, and it used to empty the cache outright.
   * The emptying was visible: every `{eval}` fell back to its placeholder, so
   * the chunk holding it was rewritten, and then rewritten again when the
   * value came back -- which in presentation mode rebuilt the slide one was
   * standing on, cell host included, although only the cell's output had
   * changed. Keeping the old value means the re-render below produces exactly
   * the html already in the document, so nothing is touched; and if the new
   * value turns out to be the same, `set` says nothing and there is no second
   * render either. A value that really did change still goes through, which
   * is the whole point of invalidating.
   *
   * And no render is asked for here, which is the point of the second
   * version of this. Asking for one meant that a document holding a single
   * `{eval}` anywhere re-rendered in full after every cell run -- every chunk
   * rewritten, every code cell re-paired with its widget, and, on a deck,
   * every slide re-furnished. A flash, after each turn of a slider, for a
   * value that usually has not moved.
   *
   * The expressions are re-evaluated directly instead, each through the
   * thunk it was submitted with. A value that comes back the same is recorded
   * in silence by `set`; one that really changed fires the listeners and the
   * document is rendered then -- which is the only moment that ever needed
   * it.
   */
  invalidate() {
    this._epoch++;
    this._pending.clear();
    if (this._map.size === 0) return;
    for (const key of this._map.keys()) this._stale.add(key);
    for (const key of [...this._map.keys()]) {
      const how = this._how.get(key);
      // No thunk means the key was recorded by an older path: it is left
      // stale, and the next render re-submits it as it always did.
      if (how) this.resolve(key, how());
    }
  },
  /**
   * Forget everything, for when the values cannot be trusted at all -- a
   * namespace restored from a sidecar, say. Silent when there was nothing
   * cached, since there is then nothing to re-render.
   */
  clear() {
    this._epoch++;
    this._stale.clear();
    this._pending.clear();
    this._how.clear();
    const had = this._map.size > 0;
    this._map.clear();
    if (had) this._listeners.forEach(fn => fn(null));
  }
};

// Mark every {eval} result for re-evaluation whenever a code-cell is executed,
// so expressions that read Python variables pick up the new state.
onCellExecuted(() => evalCache.invalidate());

// ─── {eval} role ──────────────────────────────────────────────────────────────

const EVAL_RESULT_RULE = "eval_result";

const escapeHtml = (s) =>
  String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/**
 * Turn the {kind, value} answer of the engine's evaluate() into inline HTML.
 *
 * Text is escaped. The three rich kinds are the object's own rendering, which
 * is markup by definition -- it was produced by the document's own code, like
 * any HTML the source contains, so escaping it would only show its tags.
 */
function renderEvalValue(val) {
  switch (val?.kind) {
    case "html":
    case "svg":
      return `<span class="eval-result eval-rich">${val.value}</span>`;
    case "png":
      return `<img class="eval-result eval-image" alt="{eval} result" src="data:image/png;base64,${val.value}">`;
    case "error": {
      const msg = escapeHtml(val.value).replace(/"/g, "&quot;");
      return `<span class="eval-error" title="${msg}">⚠ eval error</span>`;
    }
    default:
      return `<span class="eval-result">${escapeHtml(val?.value ?? "")}</span>`;
  }
}

/**
 * {eval} role — evaluates a Python expression via Pyodide and inserts its
 * representation inline in the text flow (per mystmd.org spec).
 *
 * Usage:  {eval}`2 + 2`   →   4
 *
 * An object that knows how to draw itself -- _repr_html_, _repr_svg_ or
 * _repr_png_ -- is drawn rather than flattened to str(). That covers static
 * output only: a live widget needs a host that survives the re-render of its
 * chunk, which is what a code-cell provides and a role does not.
 *
 * The result is cached in evalCache. On first encounter a placeholder is
 * rendered; once the async evaluation settles the cache notifies its
 * subscribers, which triggers a re-render that inserts the real value.
 */
export class EvalRole extends Role {
  run({ content }) {
    const expr = content.trim();
    const token = new this.state.Token(EVAL_RESULT_RULE, "", 0);

    // The same expression means different things in two namespaces, so the
    // cache key carries the namespace; the expression alone would let one
    // document answer for another.
    const space = this.state.env.pythonSpace ?? "shared";
    const cacheKey = `${space}\u0000${expr}`;

    // A known value is shown even when it is marked stale: it is the last
    // thing this expression answered, and showing a placeholder instead
    // would rewrite the chunk twice for a value that may well be unchanged.
    const known = evalCache.has(cacheKey);
    // Traced on demand -- `window.mystralCellDebug = true` -- because an
    // {eval} that shows nothing can mean three different things: the role
    // never ran, it ran and the cache holds an empty value, or the value
    // never came back. The three look identical on the page.
    if (globalThis.mystralCellDebug) {
      console.log(
        "[eval] role",
        JSON.stringify({ expr, space, known, stale: evalCache.isStale(cacheKey), value: known ? evalCache.get(cacheKey) : null }),
      );
    }
    if (!known || evalCache.isStale(cacheKey)) {
      // The thunk goes with it, so a cell run can ask the same question again
      // without a render (see `invalidate`).
      evalCache.resolve(cacheKey, runtime(space).evaluate(expr, space), () => runtime(space).evaluate(expr, space));
    }
    if (known) {
      token.content = renderEvalValue(evalCache.get(cacheKey));
    } else {
      const safeExpr = expr.replace(/"/g, "&quot;");
      token.content = `<span class="eval-pending" title="{eval} ${safeExpr}">⋯</span>`;
    }
    return [token];
  }
}


/** Encode le code en base64 UTF-8-safe. */
function encodeCode(code) {
  return btoa(unescape(encodeURIComponent(code)));
}

/** Décode le base64 en code UTF-8. */
export function decodeCode(encoded) {
  return decodeURIComponent(escape(atob(encoded)));
}

/** Génère l'HTML du div placeholder partagé par fence et directive. */
function placeholderHtml(id, encoded, packages, linenos, space, spaceLabel, folded = false) {
  // The namespace is written into the HTML rather than looked up when the cell
  // runs: it follows the render, so it is right even with several documents
  // open, and a change of `python:` in the frontmatter reaches the cells the
  // moment the document is re-rendered.
  return `<div id="${id}" class="code-cell-host" data-code="${encoded}" data-packages='${JSON.stringify(packages)}' data-fold="${folded ? "1" : ""}" data-linenos="${linenos}" data-python-space="${space ?? "shared"}" data-python-space-label="${spaceLabel ?? "shared"}"></div>`;
}

// Un seul observateur par conteneur parent
const observerRegistry = new WeakMap();

/**
 * Installe (une seule fois) un MutationObserver sur `parent` qui détecte
 * les divs .code-cell-host non encore initialisés et appelle initCodeCell().
 */
function ensureObserver(parent, owner = "") {
  if (observerRegistry.has(parent)) return;

  const initPending = (el, evictedHost) => {
    if (el.dataset.initialized) return;
    const encoded  = el.dataset.code ?? "";
    const code     = encoded ? decodeCode(encoded) : "";
    const packages = JSON.parse(el.dataset.packages ?? "[]");
    const linenos  = el.dataset.linenos === "true";
    const hash     = el.id;
    const cacheKey = cellKey(owner, hash);

    // ── Réutilisation d'un widget évincé ────────────────────────────────
    // On cherche dans le cache un élément qui n'est plus dans le DOM
    // (évincé par le re-render du chunk) et portant le même code. Les options
    // de vue, elles, sont réappliquées à l'hôte repris plus bas : elles ne
    // font pas partie de son identité.
    if (evictedHost?.dataset.initialized) {
      const textarea = evictedHost.querySelector(".pyodide-editor");
      cellTrace("paired with an evicted widget", evictedHost, { placeholder: el.id, hasEditor: Boolean(textarea) });
      if (textarea) {
        // .value est soit textarea.value (legacy) soit le getter CM6 défini dans pyodideRunner.js
        const prevCode = textarea.value;
        cellTrace("code compared", evictedHost, { same: prevCode === code, was: (prevCode ?? "").length, now: code.length });
        if (prevCode !== code) {
          // Le code a changé (édition dans le CM editor) :
          // mettre à jour l'éditeur silencieusement (sans déclencher de sync CM)
          textarea._suppressSync = true;
          textarea._updateCode?.(code);
          textarea.value = code;  // setter CM6 ou textarea.value
          requestAnimationFrame(() => { textarea._suppressSync = false; });
          // Effacer la sortie (code changé, résultat périmé).
          // Vider les sous-zones, surtout pas le conteneur : les fermetures
          // créées par initCodeCell() gardent des références vers
          // .pyodide-widget-output et .pyodide-text-output. Les supprimer
          // laissait la cellule écrire dans des noeuds détachés -- l'exécution
          // affichait alors son chronomètre mais aucune sortie, jusqu'à ce
          // qu'un re-render reconstruise la cellule.
          const out = evictedHost.querySelector(".pyodide-output");
          if (out) {
            const wOut = out.querySelector(".pyodide-widget-output");
            const tOut = out.querySelector(".pyodide-text-output");
            if (wOut || tOut) {
              if (wOut) wOut.innerHTML = "";
              if (tOut) tOut.innerHTML = "";
            } else {
              out.innerHTML = ""; // cellule bâtie par une version antérieure
            }
            out.hidden = true;
          }
          const st = evictedHost.querySelector(".pyodide-status-text");
          if (st) { st.textContent = ""; st.className = "pyodide-status-text"; }
          const ti = evictedHost.querySelector(".pyodide-timing");
          if (ti) ti.textContent = "";
          // The code changed, so the moment the old one ran is no longer about
          // anything on screen.
          const ra = evictedHost.querySelector(".pyodide-ran-at");
          if (ra) { ra.textContent = ""; ra.title = ""; }
          delete evictedHost.dataset.ranAt;
        }
        // Mettre à jour la clé du cache
        for (const [k, v] of cellCache.entries()) {
          if (v === evictedHost) { cellCache.delete(k); break; }
        }
        cellCache.set(cacheKey, evictedHost);
        evictedHost.id = hash;
        // Copier data-line-id pour que la sync scroll du source-map soit correcte
        if (el.dataset.lineId !== undefined) evictedHost.dataset.lineId = el.dataset.lineId;
        // …et la clé du namespace, que la cellule relit à chaque exécution : sans
        // cela un widget réutilisé garderait l'espace qu'il avait au rendu
        // précédent, et une cellule s'exécuterait ailleurs que ses voisines.
        evictedHost.dataset.pythonSpace = el.dataset.pythonSpace ?? "shared";
        evictedHost.dataset.pythonSpaceLabel = el.dataset.pythonSpaceLabel ?? "shared";
        // Same reason: :figwidth: is read from the host at each render, so a
        // reused widget would keep the width it had when it was first built.
        // Les options de présentation suivent le re-render. Elles ne changent
        // pas le code, donc pas le hash, donc pas la clé de cache : sans cette
        // recopie l'élément réutilisé garderait celles de son premier rendu,
        // et modifier `:align:` dans le document resterait sans effet.
        evictedHost.dataset.figwidth = el.dataset.figwidth ?? "";
        evictedHost.dataset.align = el.dataset.align ?? "";
        evictedHost.dataset.caption = el.dataset.caption ?? "";
        evictedHost.dataset.description = el.dataset.description ?? "";
        evictedHost.dataset.description = el.dataset.description ?? "";
        evictedHost.dataset.number = el.dataset.number ?? "";
        evictedHost.dataset.numberLabel = el.dataset.numberLabel ?? "";
        evictedHost.dataset.label = el.dataset.label ?? "";
        // Same reason again, and one more: the strip of controls is built from
        // this attribute, so the reused widget has to be told to rebuild it.
        evictedHost.dataset.params = el.dataset.params ?? "";
        evictedHost.dataset.tags = el.dataset.tags ?? "";
        // `:packages:` manquait, et le défaut était complet : l'option écrite
        // dans une cellule déjà construite n'arrivait jamais jusqu'à
        // l'exécution, puisqu'elle ne change pas le code, donc pas le hash,
        // donc pas la cellule. Elle n'avait d'effet qu'après un rechargement
        // du document -- sous les deux moteurs, le noyau n'ayant fait que le
        // rendre visible en demandant une installation qui ne venait pas.
        evictedHost.dataset.packages = el.dataset.packages ?? "[]";
        // Line numbers travel the same way as the rest: the reused editor is
        // reconfigured rather than rebuilt, which is what makes `:linenos:`
        // take effect on the cell in front of the author instead of at the
        // next reload.
        evictedHost.dataset.linenos = el.dataset.linenos ?? "false";
        evictedHost._setLinenos?.(el.dataset.linenos === "true");
        // The re-render carries the document's answer, which the chevron has
        // just written: a reused host would otherwise keep the one it was
        // built with, and the option would stay without effect until a reload.
        evictedHost.dataset.fold = el.dataset.fold ?? "";
        evictedHost.dataset.chrome = el.dataset.chrome ?? "";
        evictedHost.dataset.chromeLabel = el.dataset.chromeLabel ?? "";
        evictedHost.dataset.dropdown = el.dataset.dropdown ?? "";
        evictedHost.dataset.dropdownLabel = el.dataset.dropdownLabel ?? "";
        evictedHost._syncParams?.();
        evictedHost._syncChrome?.();
        evictedHost._syncDropdown?.();
        evictedHost._syncCaption?.();
        el.replaceWith(evictedHost);
        evictedHost.dataset.initialized = "1";
        // Pour les textareas legacy : autoResize après replaceWith.
        // Pour les vues CM6 : la hauteur est gérée par l'éditeur lui-même.
        if (!textarea._cmView) {
          textarea.style.height = "auto";
          textarea.style.height = textarea.scrollHeight + "px";
        }
        return;
      }
    }

    initCodeCell(el, code, { packages, linenos, hash, owner });
  };

  const observer = new MutationObserver(() => {
    const newHosts = [...parent.querySelectorAll(".code-cell-host:not([data-initialized])")];
    if (!newHosts.length) return;

    // Collecter les éléments évincés (déconnectés mais initialisés)
    // Only this editor's own cells: one tab's widgets are all disconnected
    // while another tab is showing, and pass 2 would hand them out here.
    const prefix = owner + OWNER_SEP;
    const evictedSet = new Set();
    for (const [key, el] of cellCache.entries()) {
      if (!key.startsWith(prefix)) continue;
      if (!el.isConnected && el.dataset.initialized) evictedSet.add(el);
    }

    // Passe 1 : appariement exact par clé de cache (propriétaire + code)
    // Ceci est indispensable car _syncToEditor déplace l'entrée éditée en fin
    // de Map, cassant l'appariement naïf par index.
    const pairs = newHosts.map((el) => {
      const cacheKey = cellKey(owner, el.id);
      const cached = cellCache.get(cacheKey);
      if (cached && evictedSet.has(cached)) {
        evictedSet.delete(cached);
        return [el, cached];
      }
      return [el, null];
    });

    // Passe 2 : un évincé qui tenait la même place dans le document.
    //
    // Elle existe pour une cellule éditée directement dans CodeMirror : son
    // code a changé, donc son hash, donc son emplacement ne correspond plus à
    // aucune clé, et il faut bien lui rendre son widget -- avec son éditeur,
    // sa hauteur, son espace de noms.
    //
    // Distribuée dans l'ordre, comme elle l'était, elle appariait n'importe
    // quoi dès que plusieurs widgets étaient évincés ensemble -- ce qui est
    // précisément ce que fait le défilement en mode inline, où CodeMirror
    // détruit tout ce qui sort du champ. Le widget de la cellule A atterrissait
    // dans l'emplacement de la cellule B : `prevCode !== code`, donc le code
    // écrasé et la sortie vidée, puis la clé de cache et l'id réécrits, ce qui
    // désalignait les suivants. Une sortie disparue au retour du défilement,
    // et deux cellules interverties sans que rien ne le dise.
    //
    // La ligne du document tranche ce que le hash ne peut plus trancher : une
    // cellule dont on édite le code garde sa place, une cellule qui entre dans
    // le champ pendant qu'une autre en sort n'a pas la même. À défaut de ligne
    // de part et d'autre, on n'apparie que s'il n'y a qu'un candidat et qu'un
    // emplacement -- et sinon rien : `initCodeCell` retrouve le widget par sa
    // clé, qui est sûre, et construit une cellule neuve s'il n'y en a pas.
    const unmatched = pairs.filter(([, evicted]) => evicted === null);
    const remaining = [...evictedSet];
    const lineOf = (node) => node?.dataset?.lineId ?? "";
    const takeFor = (el) => {
      const line = lineOf(el);
      if (line) {
        const i = remaining.findIndex((candidate) => lineOf(candidate) === line);
        if (i !== -1) return remaining.splice(i, 1)[0];
        return null;
      }
      if (unmatched.length === 1 && remaining.length === 1) return remaining.splice(0, 1)[0];
      return null;
    };
    pairs.forEach(([el, evictedHost]) => {
      initPending(el, evictedHost ?? takeFor(el));
    });
  });

  observer.observe(parent, { childList: true, subtree: true });
  observerRegistry.set(parent, observer);
}

/**
 * Plugin markdown-it.
 * @param {import("markdown-it").default} md
 * @param {{ parent: Element, editorId: string }} options
 */
const markdownItPyodide = (md, { parent, editorId = "" } = {}) => {
  if (parent) ensureObserver(parent, editorId);

  // ── 0. Renderer rule for {eval} role tokens ─────────────────────────────
  md.renderer.rules[EVAL_RESULT_RULE] = (tokens, idx) => tokens[idx].content;

  // ── 1. Intercepte la syntaxe fence  ```code-cell ─────────────────────────

  const originalFence =
    md.renderer.rules.fence ||
    ((tokens, idx, options, env, self) => self.renderToken(tokens, idx, options));

  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const info  = token.info.trim();

    // "code-cell" ou "code-cell python" ou "code-cell python :linenos:"
    if (!info.startsWith("code-cell")) {
      return originalFence(tokens, idx, options, env, self);
    }

    const code    = token.content.trim();
    const hash    = new IMurMurHash(code, HASH_SEED).result().toString(16);
    const id      = `code-cell-${hash}`;
    const encoded = encodeCode(code);

    // Linenos : présent si ":linenos:" figure dans la ligne info
    const linenos = /\blinenos\b/i.test(info);
    // Whether the cell opens folded. A fence carries its flags in the info
    // string, where `:open: false` has nowhere to put its value, so `:fold:`
    // remains the spelling here; a directive takes `:open: false`. See
    // cellFold.js.
    const folded = infoHasFold(info);

    // Injecter les attributs du token (dont data-line-id posé par markdownSourceMap)
    // pour que le scroll-sync trouve la cellule correctement.
    let html = placeholderHtml(id, encoded, [], linenos, env.pythonSpace, env.pythonSpaceLabel, folded);
    const closeIdx = html.indexOf(">");
    html = html.slice(0, closeIdx) + self.renderAttrs(token) + html.slice(closeIdx);
    return html;
  };

  // ── 2. Intercepte les html_block de CodeCellDirective ────────────────────
  // La directive génère déjà un div.code-cell-host avec tous les data-*,
  // le MutationObserver s'en charge. Mais si parent n'était pas encore dispo
  // quand la directive a tourné, on s'assure d'enregistrer l'observateur ici.
  // (Rien d'autre à faire : le HTML est passé tel quel par markdownit.)
};

export default markdownItPyodide;
