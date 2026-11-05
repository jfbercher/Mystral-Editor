import { Annotation, EditorState, Facet, MapMode, Prec, StateField } from "@codemirror/state";
import { ensureSyntaxTree, syntaxTree } from "@codemirror/language";
import { EditorView } from "codemirror";
import { setDiagnostics, setDiagnosticsEffect } from "@codemirror/lint";
import { hoverTooltip, keymap } from "@codemirror/view";
import { acceptCompletion, autocompletion, CompletionContext } from "@codemirror/autocomplete";

const subEditorUpdate = Annotation.define();

export const subEditorId = Facet.define();

const getContentFrom = (doc, startLine) => Math.min(doc.length, startLine.to + 1);

/**
 * The blocks a sub-editor is opened on, and the language each one is in.
 *
 * `FencedCode` reads its language off the opening fence; a document's
 * frontmatter is YAML by construction and says so nowhere, hence the table
 * rather than a test on the node name alone. The node taken for the
 * frontmatter is `Frontmatter`, not the `FrontmatterContent` inside it,
 * because everything below -- the content slice, the position mapping for
 * hover, completion and diagnostics -- is written for a block whose first line
 * is a delimiter and whose content starts on the next one. Which is exactly
 * what `--- ... ---` is, so it costs nothing to say so.
 */
const SUB_EDITOR_BLOCKS = { FencedCode: null, Frontmatter: "yaml" };

/** The node that closes such a block: a fence, or a frontmatter's dashes. */
const CLOSING_MARKS = new Set(["CodeMark", "DashLine"]);

const getCodeBlockContent = (doc, startLine, endLine, closed) => {
  const contentFrom = getContentFrom(doc, startLine);
  const contentTo = Math.max(contentFrom, Math.min(doc.length, closed ? endLine.from - 1 : endLine.to));
  return { contentFrom, contentTo };
};

const codeBlocksSubeditors = (extensions, editorView, tooltipSources = {}, completionSources = [], linter) =>
  StateField.define({
    create() {
      return { extensions, editors: [], diagnostics: {}, editorView };
    },
    update(value, tr) {
      if (!tr.docChanged && !tr.reconfigured) return value;

      // update editors
      value.editors = value.editors
        .map((e) => {
          const from = tr.changes.mapPos(e.from, 1, MapMode.TrackDel);
          const to = tr.changes.mapPos(e.to, -1, MapMode.TrackDel);
          return { ...e, from, to };
        })
        .filter((e) => {
          if (e.from == null || e.to == null) {
            e.editor.destroy();
            delete value.diagnostics[e.id];
            return false;
          }
          return true;
        });
      const tree = tr.reconfigured ? ensureSyntaxTree(tr.state, tr.state.doc.length, 5000) : syntaxTree(tr.state);

      value.editors.forEach((e) => {
        const startLine = tr.state.doc.lineAt(e.from);
        const endLine = tr.state.doc.lineAt(e.to);
        const { contentFrom, contentTo } = getCodeBlockContent(tr.state.doc, startLine, endLine, CLOSING_MARKS.has(tree.resolve(e.to, -1).name));
        const contents = tr.state.doc.slice(contentFrom, contentTo).toString();
        if (contents != e.editor.state.doc.toString()) {
          linter.value = { ...linter.peek(), status: "pending" };
          e.editor.dispatch({ changes: { from: 0, to: e.editor.state.doc.length, insert: contents } });
        }
      });

      // detect new editors
      tree.iterate({
        enter(ref) {
          const declared = SUB_EDITOR_BLOCKS[ref.name];
          if (declared === undefined) return true;

          if (value.editors.some((e) => e.from == ref.from && e.to == ref.to)) return false;
          const startLine = tr.state.doc.lineAt(ref.from);
          let lang = declared;
          if (lang == null) {
            lang = startLine.text.trim().replace(/^[`~:]+/, "");
            // Normalize directive syntax: {code-cell} python → code-cell
            lang = lang.replace(/^\{([^}]+)\}.*$/, "$1").trim();
            // Take first word only (e.g. "python myfile.py" → "python")
            lang = lang.split(/\s+/)[0];
          }
          if (!(lang in value.extensions)) return false;
          // console.log("lang extrait:", JSON.stringify(lang), "extensions disponibles:", Object.keys(value.extensions), "match:", lang in value.extensions);


          const endLine = tr.state.doc.lineAt(ref.to);
          const closed = CLOSING_MARKS.has(ref.node.lastChild?.name) && ref.node.lastChild.from > ref.from;
          const { contentFrom, contentTo } = getCodeBlockContent(tr.state.doc, startLine, endLine, closed);
          const contents = tr.state.doc.slice(contentFrom, contentTo).toString();

          const id = crypto.randomUUID();
          value.editors.push({
            from: ref.from,
            to: ref.to,
            id,
            lang,
            editor: new EditorView({
              state: EditorState.create({
                doc: contents,
                extensions: [
                  ...value.extensions[lang],
                  EditorView.updateListener.of((u) => {
                    let diagnostics = u.transactions[0].effects.find((e) => e.is(setDiagnosticsEffect))?.value;
                    if (!diagnostics) return;
                    value.diagnostics[id] = diagnostics;
                    editorView.peek().dispatch({ annotations: subEditorUpdate.of(true) });
                  }),
                  subEditorId.of(id),
                ],
              }),
            }),
          });
          linter.value = { ...linter.peek(), status: "pending" };

          return false;
        },
      });

      return value;
    },
    provide(field) {
      return [
        EditorView.updateListener.of((u) => {
          if (!u.docChanged && !u.transactions.some((t) => t.annotation(subEditorUpdate))) return;
          const subeditors = u.view.state.field(field);

          if (subeditors.editors.length == 0 && linter.peek().status != "disabled") {
            linter.value = { stauts: "disabled", diagnostics: [] };
            u.view.dispatch(setDiagnostics(u.state, []));
            return;
          }

          let changeInSubEditor = false;
          u.changes.iterChangedRanges((_, __, from, to) => {
            if (subeditors.editors.some((e) => from > e.from && to < e.to)) {
              changeInSubEditor = true;
            }
          });
          if (changeInSubEditor) return;
          const diagnostics = {};

          for (const id in subeditors.diagnostics) {
            const editor = subeditors.editors.find((e) => e.id == id);
            const doc = u.view.state.doc;
            const contentFrom = getContentFrom(doc, doc.lineAt(editor.from));
            diagnostics[id] = subeditors.diagnostics[id].map((d) => ({
              ...d,
              from: Math.min(doc.length, d.from + contentFrom),
              to: Math.min(doc.length, d.to + contentFrom),
            }));
          }
          u.view.dispatch(setDiagnostics(u.state, Object.values(diagnostics).flat()));
        }),
        EditorView.updateListener.of((u) => {
          let diagnostics = u.transactions[0]?.effects?.find?.((e) => e.is(setDiagnosticsEffect))?.value;
          if (diagnostics && u.view.state.field(field).editors.length != 0) linter.value = { status: "finished", diagnostics };
        }),
        hoverTooltip(async (view, pos, side) => {
          const subeditors = view.state.field(field);
          for (const subeditor of subeditors.editors) {
            if (pos < subeditor.from || pos > subeditor.to) continue;
            const contentFrom = getContentFrom(view.state.doc, view.state.doc.lineAt(subeditor.from));
            const mappedPos = pos - contentFrom;
            const tooltip = await tooltipSources[subeditor.lang]?.doHover?.(subeditor.editor, mappedPos, side);
            if (!tooltip) return;
            return { ...tooltip, pos: tooltip.pos + contentFrom, end: tooltip.end + contentFrom };
          }
        }),
        autocompletion({
          icons: false,
        }),
        completionSources.map((src) =>
          src.languageData.of({
            autocomplete: async (/** @type {CompletionContext} */ ctx) => {
              const subeditors = ctx.view.state.field(field);
              for (const subeditor of subeditors.editors) {
                if (ctx.pos < subeditor.from || ctx.pos > subeditor.to) continue;
                const contentFrom = getContentFrom(ctx.view.state.doc, ctx.view.state.doc.lineAt(subeditor.from));
                const innerCtx = new CompletionContext(subeditor.editor.state, ctx.pos - contentFrom, ctx.explicit, subeditor.editor);
                const completion = await src.source.doComplete(innerCtx);
                if (!completion) return null;
                return { ...completion, from: completion.from + contentFrom, to: completion.to + contentFrom };
              }
            },
          }),
        ),
      ];
    },
  });

export const codeBlockExtensions = ({ extensions, editorView, tooltipSources, completionSources, linter }) => [
  codeBlocksSubeditors(extensions, editorView, tooltipSources, completionSources, linter),
  Prec.high(keymap.of([{ key: "Tab", run: (v) => acceptCompletion(v), preventDefault: true }])),
];
