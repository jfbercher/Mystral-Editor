import markdownIt from "markdown-it";
import YamlLSPWorker from "../lsp/yamlLSPWorker.js?worker";
import { yaml, yamlLanguage } from "@codemirror/lang-yaml";
import PostMessageWorkerTransport from "../lsp/messageTransport";
import { LanguageServerClient } from "codemirror-languageserver";
import { codeBlockExtensions, subEditorId } from "./codeBlockExtensions";
import { EditorView, ViewPlugin, hoverTooltip } from "@codemirror/view";
import { setDiagnostics } from "@codemirror/lint";
import { CompletionItemKind } from "vscode-languageserver-protocol";
import { cmPosToLspPos, lspPosToCmPos, lspSeverityToCm } from "../lsp/positions.js";

export const newLspClient = () => {
  const worker = new YamlLSPWorker();

  // A worker that dies while loading posts nothing, so the client's
  // `initializePromise` never settles and everything waiting on it waits for
  // ever -- silently. That is exactly how this went unnoticed: the colouring
  // kept working, because it comes from @codemirror/lang-yaml and needs no
  // server at all. These two listeners are what turn that silence into a line
  // in the console, and they stay for that reason.
  worker.addEventListener("error", (ev) => {
    console.error("[yaml-lsp] the worker failed:", ev.message || ev, ev.filename ? `${ev.filename}:${ev.lineno}` : "");
  });
  worker.addEventListener("messageerror", (ev) => {
    console.error("[yaml-lsp] a message could not be read:", ev);
  });
  const yamlTransport = new PostMessageWorkerTransport(worker);
  const client = new LanguageServerClient({
    transport: yamlTransport,
    rootUri: "file:///",
    workspaceFolders: null,
    languageId: "yaml",
    autoClose: true,
  });

  client.initializePromise?.catch((err) => {
    console.error("[yaml-lsp] initialisation refused:", err);
  });

  return client;
};

export const buildYamlLspPlugin = (lspClient, schema) =>
  ViewPlugin.fromClass(
    class {
      constructor(/** @type {EditorView} */ view) {
        this.id = view.state.facet(subEditorId)[0];
        this.view = view;
        this.version = 0;
        lspClient.attachPlugin(this);
        lspClient.initializePromise.then(() => {
          const text = stateToYamlDoc(schema, view.state);
          lspClient.textDocumentDidOpen({
            textDocument: {
              uri: getUri(this.id),
              languageId: "yaml",
              text,
              version: this.version,
            },
          });
        });
      }

      update(update) {
        if (!update.docChanged) return;
        clearTimeout(this.changesTimeout);
        this.changesTimeout = setTimeout(() => {
          if (!lspClient.ready) return;
          lspClient.textDocumentDidChange({
            textDocument: { uri: getUri(this.id), version: this.version++ },
            contentChanges: [{ text: stateToYamlDoc(schema, update.state) }],
          });
        }, 200);
      }

      processNotification(notification) {
        if (notification.method !== "textDocument/publishDiagnostics" || notification.params.uri !== getUri(this.id)) return;
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

const buildYamlTooltipSource = (lspClient) => ({
  async doHover(view, pos) {
    if (!lspClient.ready || !lspClient.capabilities?.hoverProvider || pos < 0 || pos > view.state.doc.length) return null;

    const id = view.state.facet(subEditorId)[0];
    const result = await lspClient.textDocumentHover({
      textDocument: { uri: getUri(id) },
      position: cmPosToLspPos(view.state, pos),
    });
    if (!result) return null;

    const dom = document.createElement("div");
    dom.innerHTML = tooltipRenderer.render(result.contents.value);

    return {
      pos: lspPosToCmPos(view.state, result.range.start),
      end: lspPosToCmPos(view.state, result.range.end),
      create: () => ({ dom }),
      above: true,
    };
  },
});

const buildYamlCompletionSource = (lspClient) => ({
  async doComplete(ctx) {
    if (!lspClient.ready) return;
    const id = ctx.state.facet(subEditorId)[0];
    const completions = await lspClient.textDocumentCompletion({
      textDocument: { uri: getUri(id) },
      position: cmPosToLspPos(ctx.state, ctx.pos),
    });
    const items = completions?.items ?? completions;
    if (!items?.length) return;

    // Only show completions when at the end of a line
    const line = ctx.state.doc.lineAt(ctx.pos);
    if (ctx.pos !== line.to) return;

    const token = ctx.matchBefore(/^.*/m);
    const tokenSplit = token ? token.text.trimStart().split(": ") : null;
    const completionStart = token ? tokenSplit[tokenSplit.length - 1] : null;
    const property = !token || tokenSplit.length === 1;
    const options = items
      .map(({ detail, label, kind, textEdit, insertText, documentation }) => ({
        label,
        detail,
        type: kind && CompletionItemKindMap[kind]?.toLowerCase(),
        info: documentation?.toString(),
        apply(view, _, from, to) {
          // What the server wants written, and where -- neither of which it is
          // obliged to say. A completion item may carry a `TextEdit` (with a
          // `range`), an `InsertReplaceEdit` (with `insert` and `replace` and
          // no `range`), or neither, in which case the text is `insertText` or
          // the label itself and the client decides the range. Reading
          // `textEdit.range` unconditionally is what crashed the editor on
          // `Tab`, since that is exactly the item yaml-language-server returns
          // for a plain key.
          const range = textEdit?.range ?? textEdit?.replace ?? textEdit?.insert;
          // Without a range, replace what has been typed so far: `completionStart`
          // is that prefix, and leaving it in place would insert the key after
          // it ("langu" + "language").
          const start = range
            ? lspPosToCmPos(ctx.state, range.start) + from - ctx.pos
            : Math.max(view.state.doc.lineAt(from).from, from - (completionStart?.length ?? 0));
          const startLine = view.state.doc.lineAt(start);
          const newText = textEdit?.newText ?? insertText ?? label;
          const text = newText.replace("\n", "\n" + " ".repeat(start - startLine.from)).replace(/\${[0-9]+}/g, "");
          view.dispatch({
            changes: { from: start, to, insert: text },
            selection: { anchor: start + text.length, head: start + text.length },
          });
        },
      }))
      .filter(({ type, label }) => type !== "class" && (type !== "property" || property) && (!token || label.startsWith(completionStart)));
    return { from: ctx.pos, to: ctx.pos, options, filter: false };
  },
});

/**
 * Say so when the schema cannot be read.
 *
 * The language server fetches it itself, inside the worker, and says nothing
 * when the fetch fails or brings back something that is not a schema: hover
 * and completion simply stay empty, which is indistinguishable from a working
 * chain with nothing to say. A dev server answers an unknown path with
 * `index.html` and a 200, so "not JSON" is as likely a failure as a 404 --
 * both are checked here, once, and only a failure is printed.
 */
const checkSchema = (schema) => {
  fetch(schema)
    .then(async (res) => {
      const body = await res.text();
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      JSON.parse(body);
    })
    .catch((err) => {
      console.warn(`[yaml-lsp] the schema at ${schema} could not be read, so there will be no hover or completion:`, err.message || err);
    });
};

export const yamlLSPExtension = (schema, editorView, linter, language) => {
  checkSchema(schema);
  const lspClient = newLspClient();
  const tooltipSource = buildYamlTooltipSource(lspClient);
  const completionSource = buildYamlCompletionSource(lspClient);

  if (language === "markdown") {
    return codeBlockExtensions({
      extensions: {
        yaml: [yaml(), buildYamlLspPlugin(lspClient, schema)],
      },
      editorView,
      tooltipSources: { yaml: tooltipSource },
      completionSources: [{ languageData: yamlLanguage.data, source: completionSource }],
      linter,
    });
  }

  const documentId = crypto.randomUUID();
  return [
    subEditorId.of(documentId),
    buildYamlLspPlugin(lspClient, schema),
    hoverTooltip((view, pos) => tooltipSource.doHover(view, pos)),
    yamlLanguage.data.of({ autocomplete: (ctx) => completionSource.doComplete(ctx) }),
  ];
};

const tooltipRenderer = markdownIt();
const CompletionItemKindMap = Object.fromEntries(Object.entries(CompletionItemKind).map(([key, value]) => [value, key]));

/**
 * A project configuration, as opposed to a document frontmatter.
 *
 * The two are both YAML and both ours to validate, against two different
 * schemas, and which one applies cannot be read from the editor: a tab holds
 * whatever file was opened in it, and the YAML region of a markdown document
 * is reached through the same code path as a whole `myst.yml`. So the document
 * says it itself. `version` and `project` are top-level keys of a `myst.yml`
 * and of nothing else -- neither is a page frontmatter key -- which makes
 * either of them, at column zero, a safe tell.
 */
const LOOKS_LIKE_MYST_YML = /^(?:version|project)\s*:/m;

/**
 * The schema the language server validates this document against.
 *
 * `schema` is the configured URL, and it names the frontmatter schema; a
 * project configuration is validated against its sibling. Swapping the file
 * name rather than carrying two options keeps the editor's configuration a
 * single value, and keeps the two schemas where they already live, side by
 * side.
 */
const schemaFor = (schema, text) =>
  LOOKS_LIKE_MYST_YML.test(text) ? String(schema).replace(/[^/]+$/, "myst.schema.json") : schema;

/** This is a workaround to pass the schema to the language server. The server schema file association options do not seem to work. */
const stateToYamlDoc = (schema, state) => {
  const text = state.doc.toString();
  return `# yaml-language-server: $schema=${schemaFor(schema, text)}\n${text}`;
};

const getUri = (filename) => `file:///${filename}.yaml`;
