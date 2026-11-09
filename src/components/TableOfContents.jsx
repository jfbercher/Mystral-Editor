import { useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import styled from "styled-components";
import { MystState } from "../mystState";
import { useSignalEffect } from "@preact/signals";
import { scrollToPos, scrollToVirtualLine } from "../utils";
import { numberHeadings } from "../utils/headingNumbering";
// For drag & drop of sections
import { moveSectionInText } from "../utils/sectionReorder";
import { headingInlineHtml } from "../utils/headingInline";
import { watchPreviewSection } from "../extensions/activeSection";

const Wrapper = styled.div`
  background-color: var(--panel-bg);
  padding: 20px 0;
  box-sizing: border-box;
  height: 100%;
  border: 1px solid var(--border);
  box-shadow: inset 0px 0px 4px var(--box-shadow);
  border-radius: var(--border-radius);
  overflow-y: auto;
  overscroll-behavior: contain;

  & > h1 {
    font-size: 20px;
    padding-left: ${(props) => (props.compact ? "16px" : "100px")};
    margin-bottom: 0;
  }
`;


const VerticalSparator = styled.hr`
  border: none;
  height: 1px;
  background-color: var(--border);
  margin-top: 20px;
  margin-bottom: 0;
`;

const HeadingList = styled.div`
  margin-left: ${(props) => (props.compact ? "16px" : "100px")};
  margin-top: 20px;
  ul {
    list-style: none;
  }
  & > ul {
    padding-left: 0;
  }
  li {
    overflow: hidden;
  }
  li[draggable="true"] {
    -webkit-user-drag: element;
  }
  li > span {
    display: block;
    /* Carried by every entry, active or not, so that highlighting one does not
       nudge its text sideways. */
    padding-left: 6px;
    border-radius: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-weight: bold;
    font-size: 18px;
    line-height: 150%;
    user-select: none;
    &:hover {
      text-decoration: underline;
      cursor: pointer;
    }
  }
  .dragging {
    opacity: 0.4;
  }
  /* The section the reader is in. A tint plus a bar on the edge rather than a
     strong background: the entry has to be findable at a glance in a long list
     without becoming the only thing the eye sees. color-mix() keeps it right in
     both themes -- a fixed light blue is unreadable under white text -- and the
     plain declaration above it is what a browser without color-mix() keeps. */
  li.active > span {
    background: var(--button-bg-hover);
    background: color-mix(in srgb, var(--accent-dark) 18%, transparent);
    box-shadow: inset 3px 0 0 0 var(--accent-dark);
  }
  /* Its ancestors: enough to read the path down to the current section, not
     enough to compete with it. */
  li.in-path > span {
    color: var(--accent-dark);
  }
  .included > span {
    font-style: italic;
    opacity: 0.75;
  }
  .drop-before {
    box-shadow: inset 0 2px 0 0 var(--accent-dark, #06c);
  }
  .drop-after {
    box-shadow: inset 0 -2px 0 0 var(--accent-dark, #06c);
  }
`;

/** The node of `nodes` sitting at that character offset, or null. */
function findByPos(nodes, pos) {
  for (const node of nodes) {
    if (node.pos === pos) return node;
    const found = findByPos(node.children ?? [], pos);
    if (found) return found;
  }
  return null;
}

/** The same tree without numbers, for when section numbering is off. */
function stripNumbers(nodes) {
  return nodes.map((n) => ({ ...n, number: null, children: stripNumbers(n.children ?? []) }));
}

function findSiblingsArray(nodes, target, parentChildren = nodes) {
  for (const node of nodes) {
    if (node === target) return parentChildren;
    const found = findSiblingsArray(node.children, target, node.children);
    if (found) return found;
  }
  return null;
}


function Heading({ heading, dragState, setDragState, onDrop, activePos, branch }) {
  // Read here rather than threaded through the recursion: an entry shows the
  // heading as the document renders it -- emphasis, code, maths -- and the tree
  // only holds the source text.
  const { text } = useContext(MystState);
  const isDragged = dragState.dragged === heading;
  const isDropBefore = dragState.overNode === heading && dragState.overPosition === "before";
  const isDropAfter = dragState.overNode === heading && dragState.overPosition === "after";
  const isActive = heading.pos === activePos;
  const inPath = !isActive && branch.has(heading.pos);

  let children;
  if (heading.children.length > 0) {
    children = (
      <ul>
        {heading.children.map((c) => (
          <Heading
            key={c.pos}
            heading={c}
            dragState={dragState}
            setDragState={setDragState}
            onDrop={onDrop}
            activePos={activePos}
            branch={branch}
          />
        ))}
      </ul>
    );
  }

  return (
    <li
      draggable={!heading.isTitle && !heading.included}
      className={[
        isDragged ? "dragging" : "",
        isDropBefore ? "drop-before" : "",
        isDropAfter ? "drop-after" : "",
        heading.included ? "included" : "",
        isActive ? "active" : "",
        inPath ? "in-path" : "",
      ].filter(Boolean).join(" ")}
      onDragStart={(ev) => {
        if (heading.isTitle || heading.included) return;
        ev.stopPropagation();
        ev.dataTransfer.effectAllowed = "move";
        ev.dataTransfer.setData("text/plain", heading.text); // requis par WebKit pour valider le drag
        setDragState({ dragged: heading, overNode: null, overPosition: null });
      }}
      onDragOver={(ev) => {
        // An included heading is not in this document: it can be neither moved
        // nor used as a landing place, since the move rewrites the text.
        if (heading.included) return;
        if (!dragState.dragged || dragState.dragged === heading) return;
        ev.preventDefault();
        ev.stopPropagation();
        ev.dataTransfer.dropEffect = "move";
        const rect = ev.currentTarget.getBoundingClientRect();
        const position = ev.clientY - rect.top < rect.height / 2 ? "before" : "after";
        setDragState((s) => (s.overNode === heading && s.overPosition === position ? s : { ...s, overNode: heading, overPosition: position }));
      }}
      onDragLeave={(ev) => {
        ev.stopPropagation();
      }}
      onDrop={(ev) => {
        if (heading.included) return;
        if (!dragState.dragged || dragState.dragged === heading) return;
        ev.preventDefault();
        ev.stopPropagation();
        onDrop(dragState.dragged, heading, dragState.overPosition ?? "before");
        setDragState({ dragged: null, overNode: null, overPosition: null });
      }}
      onDragEnd={() => setDragState({ dragged: null, overNode: null, overPosition: null })}
    >
      <span
        title={heading.included
          ? "From an included file — scrolls the preview; it cannot be moved from here"
          : "Go to heading"}
        data-heading-pos={heading.pos}
      >
        {heading.number ? `${heading.number} ` : ""}
        <span dangerouslySetInnerHTML={{ __html: headingInlineHtml(text?.md?.value, heading.text) }} />
      </span>
      {children}
    </li>
  );
}

export const TableOfContents = ({ compact = false }) => {
  const { headings, outlineHeadings, editorView, options, text, userSettings, activeSection } = useContext(MystState);
  const [dragState, setDragState] = useState({ dragged: null, overNode: null, overPosition: null });
  const panel = useRef(null);
  const activePos = activeSection?.value ?? null;

  const numberingEnabled = userSettings.value.find((s) => s.id === "number-headers")?.enabled ?? false;
  // The merged tree when there is one -- it is the document as it reads,
  // includes and all, and it carries the numbers the rendered text shows.
  // Falling back to the editor's own tree keeps a document without includes,
  // or a first pass before any render, behaving exactly as before.
  const numberedHeadings = useMemo(
    () => {
      const merged = outlineHeadings?.value;
      if (merged?.length) return numberingEnabled ? merged : stripNumbers(merged);
      return numberingEnabled ? numberHeadings(headings.value) : headings.value;
    },
    [headings.value, outlineHeadings?.value, numberingEnabled],
  );

  /**
   * The current section and the ones containing it, by position.
   *
   * Computed over the displayed tree rather than the editor's: the two pair by
   * character offset for a heading of this document, and an entry pulled in by
   * an `{include}` can never be the active one, since its content holds no
   * position the caret could occupy.
   */
  const branch = useMemo(() => {
    const path = new Set();
    if (activePos == null) return path;
    const walk = (nodes) => {
      for (const node of nodes) {
        if (node.pos === activePos || walk(node.children ?? [])) {
          path.add(node.pos);
          return true;
        }
      }
      return false;
    };
    walk(numberedHeadings);
    return path;
  }, [activePos, numberedHeadings]);

  /**
   * In Preview mode the editor is hidden and has nothing to say: the rendered
   * pane is what the reader sees, so it is what gets asked. Installed only for
   * that mode, and only while this panel is mounted -- which is exactly when
   * someone is looking at the answer.
   */
  useSignalEffect(() => {
    if (options.mode.value !== "Preview") return;
    const preview = text?.preview?.value;
    if (!preview) return;
    const watcher = watchPreviewSection({ preview, text, editorView, headings, activeSection });
    return () => watcher.destroy();
  });

  /**
   * Keep the current section in sight, in a table of contents too long to show
   * at once.
   *
   * Only when it has actually left the view, and never while a section is being
   * dragged: a panel that recentres itself every time the reader crosses a
   * heading would jump under the hand, and one that moves while an entry is
   * already comfortably visible would move for nothing. The margin is a fifth of
   * the panel, capped, so a short panel is not declared "out of sight" over two
   * pixels.
   */
  useEffect(() => {
    const root = panel.current;
    if (activePos == null || dragState.dragged || !root) return;
    const entry = root.querySelector(`[data-heading-pos="${activePos}"]`);
    if (!entry) return;
    const view = root.getBoundingClientRect();
    const box = entry.getBoundingClientRect();
    const margin = Math.min(48, view.height / 5);
    if (box.top >= view.top + margin && box.bottom <= view.bottom - margin) return;
    root.scrollTo({
      top: root.scrollTop + (box.top - view.top) - (view.height - box.height) / 2,
      behavior: "smooth",
    });
  }, [activePos]);

  function handleClick(ev) {
    // closest, not the target itself: the entry now holds rendered markup, so a
    // click can land on a <strong> or a KaTeX span inside the span that carries
    // the position, and reading the target's own dataset found nothing.
    const posAttr = ev.target?.closest?.("[data-heading-pos]")?.dataset?.headingPos;
    if (!posAttr) return;
    // "v<line>" is a heading of an included file: a virtual line, which
    // addresses the preview but nothing in the editor.
    if (posAttr.startsWith("v")) {
      scrollToVirtualLine(parseInt(posAttr.slice(1), 10), { text });
      return;
    }
    scrollToPos(parseInt(posAttr, 10), { editorView, options, text });
  }

  function handleDrop(draggedNode, targetNode, position) {
    // Last line of defence: the move rewrites the document's text, and neither
    // of these exists in it.
    if (draggedNode.included || targetNode.included) return;

    // The panel displays the merged tree, while the move works on the editor's
    // own: the nodes are different objects, and everything below compares by
    // identity. They are paired by character offset, which is the same value
    // in both trees for a heading of this document.
    const dragged = findByPos(headings.value, draggedNode.pos);
    const target = findByPos(headings.value, targetNode.pos);
    if (!dragged || !target) return;

    // Restriction aux frères : refuse silencieusement si pas le même parent.
    const draggedSiblings = findSiblingsArray(headings.value, dragged);
    const targetSiblings = findSiblingsArray(headings.value, target);
    if (draggedSiblings !== targetSiblings) return;

    const newText = moveSectionInText(dragged, target, position, headings.value, text.text.value);
    editorView.value.dispatch({
      changes: { from: 0, to: editorView.value.state.doc.length, insert: newText },
    });

  }

  return (
    <Wrapper compact={compact} ref={panel}>
      <h1>Table of Contents</h1>
      <VerticalSparator />
      <HeadingList compact={compact} onClick={handleClick}>
        <ul>
          {numberedHeadings.map((h) => (
            <Heading
              heading={h}
              key={h.pos}
              dragState={dragState}
              setDragState={setDragState}
              onDrop={handleDrop}
              activePos={activePos}
              branch={branch}
            />
          ))}
        </ul>
      </HeadingList>
    </Wrapper>
  );
};

