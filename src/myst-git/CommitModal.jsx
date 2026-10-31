import { useComputed, useSignal, useSignalEffect } from "@preact/signals";
import { h } from "preact";
import { EditorView } from "codemirror";
import { useContext, useEffect, useRef } from "preact/hooks";
import styled from "styled-components";
import { ExtensionBuilder } from "../extensions";
import { unifiedMergeView } from "@codemirror/merge";
import { CodeEditor } from "../components/CodeMirror";
import { MystState } from "../mystState";
import { Modal } from "../components/CommonUI";

const CommitForm = styled(Modal)`
  && {
    width: 800px;
  }

  form {
    margin-top: 20px;
  }

  .file-controls button.fold {
    border: none;
    background: transparent;
    color: inherit;
    font: inherit;
    cursor: pointer;
    padding: 0 4px;
    line-height: 1;
  }

  .binary {
    margin: 4px 0 0;
    font-size: 13px;
    opacity: 0.7;
  }

  label,
  input,
  textarea {
    display: block;
  }

  label {
    margin-bottom: 10px;
  }

  textarea,
  input {
    padding: 5px 10px;
    font-family: inherit;
    width: 100%;
    box-sizing: border-box;
    background-color: var(--button-bg);
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
  }

  input {
    margin-bottom: 20px;
  }

  button {
    cursor: pointer;
    text-transform: uppercase;
    font-size: 12px;
    font-weight: bold;
    font-family: inherit;
    border: 1px solid var(--border);
    background-color: var(--button-bg);
    height: 40px;
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 0px 15px;
    transition: 0.4s ease;
    border-radius: var(--border-radius);

    &:hover {
      background-color: var(--button-bg-hover);
      border: 1px solid var(--button-bg-hover);
    }
  }

  #diffs {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .diff-parent {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .file-controls {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  .file-name {
    display: flex;
    align-items: center;
    gap: 8px;

    input,
    label {
      display: inline;
      width: fit-content;
      margin: 0;
    }

    label.unstaged {
      text-decoration: line-through;
      color: var(--gray-700);
    }
  }
`;

/**
 * @param {object} props
 * @param {boolean} [props.open] - whether the dialog shows. Defaults to
 *   `Boolean(initialSummary)`, which is how the git wrapper has always driven
 *   it; a caller with nothing to put in the summary says so explicitly.
 * @param {boolean} [props.readOnly] - show the diffs and nothing else: no
 *   staging, no discarding, no message. What the editor's first git screen is.
 * @param {(document: object) => void} [props.onDiscard] - throw away one
 *   file's changes. Supplied by the caller rather than done here: in the
 *   collaborative wrapper that means rewriting a shared document and telling a
 *   server, which is knowledge this dialog has no business holding.
 */
const CommitModal = ({
  initialSummary = "",
  open = undefined,
  readOnly = false,
  onSubmit,
  onClose,
  onDiscard,
  documents = [],
  parent,
  latestCommit,
}) => {
  const isOpen = open ?? Boolean(initialSummary);
  const summary = useSignal(initialSummary);
  const description = useSignal("");
  const message = useComputed(() => `${summary.value}\n\n${description.value}`);
  const changedDocs = useSignal(documents);
  const stagedDocs = useSignal(documents.map((d) => d.file));
  const modalRef = useRef();

  useEffect(() => {
    if (isOpen) {
      summary.value = initialSummary;
      description.value = "";
      changedDocs.value = documents;
      stagedDocs.value = documents.map((d) => d.file);
      modalRef.current?.showModal?.();
      modalRef.current.onclose = onClose;
    } else if (modalRef.current?.open) {
      // Closed from the outside, where it has already been handled, so this is not a cancel.
      modalRef.current.onclose = () => {};
      modalRef.current.close();
    }
  }, [isOpen]);

  function handleStage(staged, file) {
    if (staged) {
      stagedDocs.value = [...stagedDocs.peek(), file];
    } else {
      stagedDocs.value = stagedDocs.peek().filter((f) => f !== file);
    }
  }

  return (
    <CommitForm ref={modalRef}>
      <div id="diffs">
        {/* Only mount the diff editors while the modal is open, so they are destroyed on close. */}
        {isOpen &&
          changedDocs.value.map((d) => (
            <Diff
              key={d.file}
              parent={parent}
              document={d}
              readOnly={readOnly}
              onStage={(staged) => handleStage(staged, d.file)}
              discardFile={
                onDiscard &&
                (() => {
                  handleStage(false, d.file);
                  onDiscard(d);
                  changedDocs.value = changedDocs.peek().filter((doc) => doc.file !== d.file);
                  if (changedDocs.peek().length === 0) modalRef.current?.close?.();
                })
              }
            />
          ))}
      </div>
      {readOnly ? (
        <div className="buttons">
          <div />
          <button type="button" onClick={() => modalRef.current.close()}>
            Close
          </button>
        </div>
      ) : latestCommit ? (
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            if (stagedDocs.value.length === 0) return;
            modalRef.current.onclose = () => {};
            modalRef.current.close();
            onSubmit({ summary: summary.value, message: message.value, stagedDocs: stagedDocs.value });
          }}
        >
          <label htmlFor="summary">Commit summary</label>
          <input id="summary" type="text" value={summary.value} onChange={(ev) => (summary.value = ev.target.value)} autoFocus />
          <label htmlFor="description">Commit description</label>
          <textarea
            name="description"
            id="description"
            value={description.value}
            onChange={(ev) => (description.value = ev.target.value)}
            cols={80}
            rows={5}
          />
          <div className="buttons">
            <button type="submit" disabled={stagedDocs.value.length === 0}>
              Commit
            </button>
            <button type="button" onClick={() => modalRef.current.close()}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <>
          <p>You can only commit changes from the latest commit of a branch</p>
          <div className="buttons">
            <div />
            <button onClick={() => modalRef.current.close()}>Close</button>
          </div>
        </>
      )}
    </CommitForm>
  );
};

/**
 * Built on first use, not when this module loads.
 *
 * `styled(CodeEditor)` reads `CodeEditor` as soon as the module body runs, and
 * this dialog is now reachable from the editor's own import graph -- where
 * `CodeMirror.jsx` may not have finished initialising yet. That is a temporal
 * dead zone, and it showed as `Cannot access 'CodeEditor' before
 * initialization` at startup, with nothing on screen to say where it came
 * from. Deferring the call moves the read to render time, by which point every
 * module has run, and makes the dialog safe to import from anywhere rather
 * than safe along one particular path.
 */
let mergeViewEditor = null;
const MergeViewEditor = () => (mergeViewEditor ??= styled(CodeEditor)``);

const Diff = ({ document, parent, onStage, discardFile, readOnly = false }) => {
  const { options } = useContext(MystState);
  const diffRef = useRef();
  const staged = useSignal(true);
  // Folded per file, and open to begin with: the question "what changed" is
  // asked of a diff, and a commit touching a dozen files is read by folding
  // away the ones already understood rather than by scrolling past them.
  const folded = useSignal(false);

  useEffect(() => {
    if (!diffRef.current) return;
    const view = new EditorView({
      parent: diffRef.current,
      root: parent,
      doc: document.text,
      extensions: [
        ...ExtensionBuilder.basicSetup().useLanguage("markdown", options.transforms.value).useReadonly().create(),
        unifiedMergeView({
          original: document.initialText,
          mergeControls: false,
          collapseUnchanged: {
            margin: 3,
            minSize: 6,
          },
        }),
      ],
    });

    return () => {
      view.destroy();
    };
  }, [diffRef.current]);

  useSignalEffect(() => onStage(staged.value));

  return (
    <div className="diff-parent">
      <div className="file-controls">
        <div className="file-name">
          {!document.binary && (
            <button
              type="button"
              className="fold"
              aria-expanded={!folded.value}
              title={folded.value ? "Show what changed" : "Hide what changed"}
              onClick={() => (folded.value = !folded.value)}
            >
              {folded.value ? "›" : "⌄"}
            </button>
          )}
          {!readOnly && (
          <input
            type="checkbox"
            name={document.file}
            id={document.file}
            checked={staged.value}
            onChange={(ev) => (staged.value = ev.target.checked)}
          />
          )}
          <label
            for={document.file}
            className={staged.value ? "" : "unstaged"}
            title={staged.value ? "This file will be committed" : "This file will not be committed"}
          >
            {document.file}
          </label>
        </div>
        {discardFile && <button onClick={() => discardFile()}>Discard changes</button>}
      </div>
      {/* Bytes have no diff to show, and reading them as text printed a
          screenful of replacement characters. The file is still committed. */}
      {document.binary ? (
        <p className="binary">Not a text file — committed as it is, with nothing to compare.</p>
      ) : (
        staged.value && !folded.value && h(MergeViewEditor(), { ref: diffRef })
      )}
    </div>
  );
};

export default CommitModal;
