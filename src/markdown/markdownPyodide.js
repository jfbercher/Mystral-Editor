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

import IMurMurHash from "imurmurhash";
import { initCodeCell, cellCache, runExpression, onCellExecuted } from "./pyodideRunner";
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
  _listeners: new Set(),
  has(key) { return this._map.has(key); },
  get(key) { return this._map.get(key); },
  set(key, value) {
    this._map.set(key, value);
    this._listeners.forEach(fn => fn(key));
  },
  /**
   * Kick off async evaluation if not already cached.
   * On success/failure, stores the result and notifies listeners.
   */
  resolve(key, promise) {
    if (this._map.has(key)) return;
    Promise.resolve(promise)
      .then(result => this.set(key, result))
      .catch(err => {
        const msg = String(err).replace(/"/g, "&quot;");
        this.set(key, `<span class="eval-error" title="${msg}">⚠ eval error</span>`);
      });
  },
  /** Subscribe to results; returns an unsubscribe function. */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  },
  /** Clear all cached results (e.g. on kernel restart). */
  clear() { this._map.clear(); }
};

// Invalidate all {eval} results whenever a code-cell is executed,
// so expressions that read Python variables pick up the new state.
onCellExecuted(() => evalCache.clear());

// ─── {eval} role ──────────────────────────────────────────────────────────────

const EVAL_RESULT_RULE = "eval_result";

/**
 * {eval} role — evaluates a Python expression via Pyodide and inserts its
 * string representation inline in the text flow (per mystmd.org spec).
 *
 * Usage:  {eval}`2 + 2`   →   4
 *
 * The result is cached in evalCache. On first encounter a placeholder is
 * rendered; once the async evaluation settles the cache notifies its
 * subscribers, which triggers a re-render that inserts the real value.
 */
export class EvalRole extends Role {
  run({ content }) {
    const expr = content.trim();
    const token = new this.state.Token(EVAL_RESULT_RULE, "", 0);

    if (evalCache.has(expr)) {
      const val = evalCache.get(expr);
      // val is already escaped/safe HTML from runExpression (plain string) or
      // an error <span> from the catch branch of evalCache.resolve().
      const safe = val.startsWith("<") ? val
        : val.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      token.content = `<span class="eval-result">${safe}</span>`;
    } else {
      // Kick off async evaluation; return a placeholder for now.
      evalCache.resolve(expr, runExpression(expr));
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
function placeholderHtml(id, encoded, packages, linenos) {
  return `<div id="${id}" class="code-cell-host" data-code="${encoded}" data-packages='${JSON.stringify(packages)}' data-linenos="${linenos}"></div>`;
}

// Un seul observateur par conteneur parent
const observerRegistry = new WeakMap();

/**
 * Installe (une seule fois) un MutationObserver sur `parent` qui détecte
 * les divs .code-cell-host non encore initialisés et appelle initCodeCell().
 */
function ensureObserver(parent) {
  if (observerRegistry.has(parent)) return;

  const initPending = (el, evictedHost) => {
    if (el.dataset.initialized) return;
    const encoded  = el.dataset.code ?? "";
    const code     = encoded ? decodeCode(encoded) : "";
    const packages = JSON.parse(el.dataset.packages ?? "[]");
    const linenos  = el.dataset.linenos === "true";
    const hash     = el.id;
    const cacheKey = hash + (linenos ? "-ln" : "");

    // ── Réutilisation d'un widget évincé ────────────────────────────────
    // On cherche dans le cache un élément qui n'est plus dans le DOM
    // (évincé par le re-render du chunk) et dont les options (linenos)
    // correspondent. On réutilise ce widget plutôt que d'en créer un neuf.
    if (evictedHost?.dataset.initialized) {
      const textarea = evictedHost.querySelector(".pyodide-editor");
      if (textarea) {
        // .value est soit textarea.value (legacy) soit le getter CM6 défini dans pyodideRunner.js
        const prevCode = textarea.value;
        if (prevCode !== code) {
          // Le code a changé (édition dans le CM editor) :
          // mettre à jour l'éditeur silencieusement (sans déclencher de sync CM)
          textarea._suppressSync = true;
          textarea._updateCode?.(code);
          textarea.value = code;  // setter CM6 ou textarea.value
          requestAnimationFrame(() => { textarea._suppressSync = false; });
          // Effacer la sortie (code changé, résultat périmé)
          const out = evictedHost.querySelector(".pyodide-output");
          if (out) { out.innerHTML = ""; out.hidden = true; }
          const st = evictedHost.querySelector(".pyodide-status-text");
          if (st) { st.textContent = ""; st.className = "pyodide-status-text"; }
          const ti = evictedHost.querySelector(".pyodide-timing");
          if (ti) ti.textContent = "";
        }
        // Mettre à jour la clé du cache
        for (const [k, v] of cellCache.entries()) {
          if (v === evictedHost) { cellCache.delete(k); break; }
        }
        cellCache.set(cacheKey, evictedHost);
        evictedHost.id = hash;
        // Copier data-line-id pour que la sync scroll du source-map soit correcte
        if (el.dataset.lineId !== undefined) evictedHost.dataset.lineId = el.dataset.lineId;
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

    initCodeCell(el, code, { packages, linenos, hash });
  };

  const observer = new MutationObserver(() => {
    const newHosts = [...parent.querySelectorAll(".code-cell-host:not([data-initialized])")];
    if (!newHosts.length) return;

    // Collecter les éléments évincés (déconnectés mais initialisés)
    const evictedSet = new Set();
    for (const [, el] of cellCache.entries()) {
      if (!el.isConnected && el.dataset.initialized) evictedSet.add(el);
    }

    // Passe 1 : appariement exact par clé de cache (hash + linenos)
    // Ceci est indispensable car _syncToEditor déplace l'entrée éditée en fin
    // de Map, cassant l'appariement naïf par index.
    const pairs = newHosts.map((el) => {
      const linenos = el.dataset.linenos === "true";
      const cacheKey = el.id + (linenos ? "-ln" : "");
      const cached = cellCache.get(cacheKey);
      if (cached && evictedSet.has(cached)) {
        evictedSet.delete(cached);
        return [el, cached];
      }
      return [el, null];
    });

    // Passe 2 : assigner les évincés restants aux placeholders sans correspondance
    // (cas d'une édition directe dans CM sans sync textarea→CM préalable)
    const remaining = [...evictedSet];
    let ri = 0;
    pairs.forEach(([el, evictedHost]) => {
      initPending(el, evictedHost !== null ? evictedHost : (remaining[ri++] ?? null));
    });
  });

  observer.observe(parent, { childList: true, subtree: true });
  observerRegistry.set(parent, observer);
}

/**
 * Plugin markdown-it.
 * @param {import("markdown-it").default} md
 * @param {{ parent: Element }} options
 */
const markdownItPyodide = (md, { parent } = {}) => {
  if (parent) ensureObserver(parent);

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

    // Injecter les attributs du token (dont data-line-id posé par markdownSourceMap)
    // pour que le scroll-sync trouve la cellule correctement.
    let html = placeholderHtml(id, encoded, [], linenos);
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
