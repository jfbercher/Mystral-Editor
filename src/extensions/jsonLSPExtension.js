/**
 * Validation, hover and completion for a JSON document.
 *
 * Written beside `yamlLSPExtension.js` rather than inside it. The two share
 * the shape of the thing -- a worker, a client, a view plugin that posts the
 * document and turns the answers into diagnostics -- but almost none of the
 * detail: a JSON document is never a region of something else, so there are no
 * sub-editors and no position mapping; the schema is associated in the worker
 * instead of being written into the text; and a JSON completion item carries
 * the range it replaces, so none of the YAML heuristics about what has been
 * typed are needed here. What the two genuinely have in common lives in
 * `lsp/positions.js`.
 */
import markdownIt from "markdown-it";
import JsonLSPWorker from "../lsp/jsonLSPWorker.js?worker";
import { jsonLanguage } from "@codemirror/lang-json";
import PostMessageWorkerTransport from "../lsp/messageTransport";
import { LanguageServerClient } from "codemirror-languageserver";
import { EditorView, ViewPlugin, hoverTooltip } from "@codemirror/view";
import { autocompletion, snippet, startCompletion } from "@codemirror/autocomplete";
import { setDiagnostics } from "@codemirror/lint";
import { CompletionItemKind } from "vscode-languageserver-protocol";
import { cmPosToLspPos, lspPosToCmPos, lspSeverityToCm } from "../lsp/positions.js";

const tooltipRenderer = markdownIt();
const CompletionItemKindMap = Object.fromEntries(Object.entries(CompletionItemKind).map(([key, value]) => [value, key]));

/**
 * The uri the document is opened under.
 *
 * It decides which schema the server applies, through the association the
 * worker declares, and it is a name of our choosing rather than the file's
 * path: the editor opens one configuration file at a time, and a path from
 * the user's disk would only make the association harder to state.
 */
const URI = "file:///config.json";

const newLspClient = () => {
  const worker = new JsonLSPWorker();

  // A worker that dies while loading posts nothing and the client's
  // `initializePromise` never settles, so the whole chain waits for ever in
  // silence. The same two listeners as on the YAML side, for the same reason.
  worker.addEventListener("error", (ev) => {
    console.error("[json-lsp] the worker failed:", ev.message || ev, ev.filename ? `${ev.filename}:${ev.lineno}` : "");
  });
  worker.addEventListener("messageerror", (ev) => {
    console.error("[json-lsp] a message could not be read:", ev);
  });

  const client = new LanguageServerClient({
    transport: new PostMessageWorkerTransport(worker),
    rootUri: "file:///",
    workspaceFolders: null,
    languageId: "json",
    autoClose: true,
  });
  client.initializePromise?.catch((err) => {
    console.error("[json-lsp] initialisation refused:", err);
  });
  return client;
};

const buildPlugin = (lspClient, holder) =>
  ViewPlugin.fromClass(
    class {
      constructor(/** @type {EditorView} */ view) {
        this.view = view;
        this.version = 0;
        this.dirty = false;
        // The hover and completion sources reach the live instance through
        // this, to flush pending changes before they ask. A field on the
        // closure rather than a global: one editor, one plugin, one holder.
        holder.current = this;
        lspClient.attachPlugin(this);
        lspClient.initializePromise.then(() => {
          lspClient.textDocumentDidOpen({
            textDocument: { uri: URI, languageId: "json", text: view.state.doc.toString(), version: this.version },
          });
        });
      }

      update(update) {
        if (!update.docChanged) return;
        this.dirty = true;
        clearTimeout(this.changesTimeout);
        this.changesTimeout = setTimeout(() => this.flush(), 200);
      }

      /**
       * Send what the editor holds now, rather than in 200 ms.
       *
       * The changes are debounced, which is right while typing and wrong
       * before a question: a completion asked right after an insertion
       * reached a server still holding the previous text, so it answered for
       * a position that was somewhere else entirely -- nothing, in practice.
       * That was the whole of "no proposals where the cursor was just put",
       * and it was never the activation. Notifications keep their order on
       * the way to the worker, so a flush before a request is enough to make
       * the answer be about the document in front of the user.
       */
      flush() {
        clearTimeout(this.changesTimeout);
        if (!this.dirty || !lspClient.ready) return;
        this.dirty = false;
        lspClient.textDocumentDidChange({
          textDocument: { uri: URI, version: this.version++ },
          contentChanges: [{ text: this.view.state.doc.toString() }],
        });
      }

      processNotification(notification) {
        if (notification.method !== "textDocument/publishDiagnostics" || notification.params.uri !== URI) return;
        const diag = notification.params.diagnostics.map((d) => ({
          message: d.message,
          source: d.source,
          from: lspPosToCmPos(this.view.state, d.range.start),
          to: lspPosToCmPos(this.view.state, d.range.end),
          severity: lspSeverityToCm(d.severity),
        }));
        this.view.dispatch(setDiagnostics(this.view.state, diag));
      }
    },
  );

/**
 * The markdown of a hover, whichever of its three shapes the server used.
 *
 * The protocol allows a `MarkupContent` ({ kind, value }), a bare string, or
 * an array of either -- and the JSON service uses the last one, `[result]`,
 * which is exactly the form the first version of this did not read. So every
 * hover came back empty, which looks the same as a server with nothing to
 * say.
 */
const hoverText = (contents) => {
  const one = (c) => (typeof c === "string" ? c : (c?.value ?? ""));
  const text = Array.isArray(contents) ? contents.map(one).join("\n\n") : one(contents);
  return text.trim() || null;
};

const buildTooltipSource = (lspClient, holder) => async (view, pos) => {
  if (!lspClient.ready || !lspClient.capabilities?.hoverProvider || pos < 0 || pos > view.state.doc.length) return null;
  holder.current?.flush();
  const result = await lspClient.textDocumentHover({
    textDocument: { uri: URI },
    position: cmPosToLspPos(view.state, pos),
  });
  const text = hoverText(result?.contents);
  if (!text) return null;

  const dom = document.createElement("div");
  dom.innerHTML = tooltipRenderer.render(text);
  // A hover without a range is legitimate -- it means "here" -- so the word
  // under the cursor is used rather than giving up on the tooltip.
  const word = view.state.wordAt(pos);
  return {
    pos: result.range ? lspPosToCmPos(view.state, result.range.start) : (word?.from ?? pos),
    end: result.range ? lspPosToCmPos(view.state, result.range.end) : (word?.to ?? pos),
    create: () => ({ dom }),
    above: true,
  };
};

/**
 * Insert a snippet, then offer what can go in the hole it left.
 *
 * Completion opens by itself on typing and on nothing else: CodeMirror reads
 * `input.type` and no other event, so a cursor that arrived somewhere by
 * *accepting* a completion sits there with nothing offered. That is the whole
 * of the "only on Ctrl-Space" complaint: accepting `"slides": {}` drops the
 * cursor between the braces -- where the schema knows fourteen keys -- and
 * waits to be asked.
 *
 * Only for a snippet: an item with no placeholder inserts a finished value,
 * after which proposing more would be noise. The same intent is also declared
 * to CodeMirror through `activateOnCompletion`, further down -- the two
 * routes do not conflict, and which of them actually fires is what the
 * diagnosis needed.
 *
 * The restart is deferred by a tick because the snippet's own dispatch has to
 * land first -- completion asked for mid-dispatch would read the document as
 * it was before the insertion.
 */
const fillThenContinue = (template) => {
  const insert = snippet(template);
  return (view, completion, from, to) => {
    insert(view, completion, from, to);
    setTimeout(() => startCompletion(view), 0);
  };
};

/** `InsertTextFormat.Snippet`, which is what the JSON service sends. */
const SNIPPET = 2;

/**
 * An LSP snippet as a CodeMirror one.
 *
 * Both have placeholders and they spell them differently: the protocol writes
 * `$1`, `${1}` and `${1:a default}`, CodeMirror writes `#{}` and `#{a
 * default}`. Stripping them instead, as this first did, is what produced
 * `"autoSaveEnabled": ,` with the cursor at the end -- because the server
 * sends `"autoSaveEnabled": $1,`, separator included, and the hole where the
 * value goes was being thrown away along with the mark that showed where it
 * was. Translated rather than removed, the comma stays and the cursor lands
 * in the hole, which is the whole point of the server sending one.
 */
const toCmSnippet = (text) =>
  text
    .replace(/\\\$/g, "\u0000")
    .replace(/\$\{[0-9]+:([^}]*)\}/g, "#{$1}")
    .replace(/\$\{[0-9]+\}/g, "#{}")
    .replace(/\$[0-9]+/g, "#{}")
    .replace(/\u0000/g, "$");

const buildCompletionSource = (lspClient, holder) => async (ctx) => {
  if (!lspClient.ready) return null;
  holder.current?.flush();
  const completions = await lspClient.textDocumentCompletion({
    textDocument: { uri: URI },
    position: cmPosToLspPos(ctx.state, ctx.pos),
  });
  const items = completions?.items ?? completions;
  if (!items?.length) return null;

  // Where the word being completed starts. The server says so, in the range
  // its first item would replace; without that, the token is taken to start
  // at the cursor. It is clamped to the current line because the replacement
  // must never reach backwards -- or forwards: `to` is the cursor and not the
  // end of the server's range, which may cover the value already written and
  // would otherwise be eaten along with the key.
  const line = ctx.state.doc.lineAt(ctx.pos);
  const firstRange = items[0]?.textEdit?.range ?? items[0]?.textEdit?.replace ?? items[0]?.textEdit?.insert;
  const from = firstRange ? Math.min(ctx.pos, Math.max(line.from, lspPosToCmPos(ctx.state, firstRange.start))) : ctx.pos;

  const options = items.map(({ label, detail, kind, documentation, textEdit, insertText, insertTextFormat }) => {
    const text = textEdit?.newText ?? insertText ?? label;
    return {
      label,
      detail,
      type: kind && CompletionItemKindMap[kind]?.toLowerCase(),
      info: documentation?.value ?? (typeof documentation === "string" ? documentation : undefined),
      apply: insertTextFormat === SNIPPET ? fillThenContinue(toCmSnippet(text)) : text,
      // Read back by `activateOnCompletion` below. A custom field on a
      // completion is carried through untouched, which is the documented way
      // of telling the two kinds of item apart at that point.
      continues: insertTextFormat === SNIPPET,
    };
  });

  // `filter` left on, and `from` at the start of the word: CodeMirror narrows
  // the list to what has been typed. The server answers for a position, not
  // for a prefix -- which is why every key was offered whatever the letter.
  return { from, to: ctx.pos, options };
};

/**
 * The JSON language support, with the server attached.
 *
 * `schema` is accepted and ignored for now: the association lives in the
 * worker, which exists for the configuration file alone. The argument is kept
 * so that the call site reads like the YAML one and so that naming a second
 * schema later is a change in one place.
 */
export const jsonLSPExtension = (_schema, _editorView, _linter) => {
  const lspClient = newLspClient();
  // Filled by the plugin when it is created; read by the two sources, which
  // exist before any view does.
  const holder = { current: null };
  const doHover = buildTooltipSource(lspClient, holder);
  // The language itself is installed by `useLanguage("json")`, as it is for
  // YAML: this adds the server to it and nothing else.
  return [
    // Belt and braces for the same thing, and the documented route: CodeMirror
    // opens completion by itself only on `input.type`, so a cursor left in a
    // snippet's hole has to be told. `activateOnCompletion` is read from the
    // accepted item, which is why the items that leave a hole are marked.
    // Adding a second `autocompletion()` is safe: its state field and view
    // plugins are the same values the editor already has, so they are
    // deduplicated, and only this one configuration sets this field.
    autocompletion({ activateOnCompletion: (completion) => completion?.continues === true }),
    buildPlugin(lspClient, holder),
    hoverTooltip((view, pos) => doHover(view, pos)),
    jsonLanguage.data.of({ autocomplete: buildCompletionSource(lspClient, holder) }),
  ];
};
