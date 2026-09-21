import { python } from "@codemirror/lang-python";
import { syntaxHighlighting } from "@codemirror/language";
import { pythonHighlightStyle } from "./pythonHighlightStyle";
import { codeBlockExtensions } from "./codeBlockExtensions";

const pythonExtensions = [python(), syntaxHighlighting(pythonHighlightStyle)];

export const codeBlockLanguages = (editorView, linter) =>
  codeBlockExtensions({
    extensions: {
      python: pythonExtensions,
      "code-cell": pythonExtensions,
    },
    editorView,
    tooltipSources: {},
    completionSources: [],
    linter,
  });
