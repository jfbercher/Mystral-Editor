import { useContext, useMemo,  useState } from "preact/hooks";
import styled from "styled-components";
import { MystState } from "../mystState";
import { useSignalEffect } from "@preact/signals";
import { scrollToPos } from "../utils";
import { numberHeadings } from "../utils/headingNumbering";
// For drag & drop of sections
import { moveSectionInText } from "../utils/sectionReorder";

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
  .included > span {
    font-style: italic;
    opacity: 0.75;
    cursor: default;
  }
  .included > span:hover {
    text-decoration: none;
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


function Heading({ heading, dragState, setDragState, onDrop }) {
  const isDragged = dragState.dragged === heading;
  const isDropBefore = dragState.overNode === heading && dragState.overPosition === "before";
  const isDropAfter = dragState.overNode === heading && dragState.overPosition === "after";

  let children;
  if (heading.children.length > 0) {
    children = (
      <ul>
        {heading.children.map((c) => (
          <Heading key={c.pos} heading={c} dragState={dragState} setDragState={setDragState} onDrop={onDrop} />
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
          ? "From an included file — shown for reference; it cannot be moved from here"
          : "Go to heading"}
        data-heading-pos={heading.included ? undefined : heading.pos}
      >
        {heading.number ? `${heading.number} ` : ""}
        {heading.text}
      </span>
      {children}
    </li>
  );
}

export const TableOfContents = ({ compact = false }) => {
  const { headings, outlineHeadings, editorView, options, text, userSettings } = useContext(MystState);
  const [dragState, setDragState] = useState({ dragged: null, overNode: null, overPosition: null });

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

  function handleClick(ev) {
    const posAttr = ev.target?.dataset?.headingPos;
    if (!posAttr) return;
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
    <Wrapper compact={compact}>
      <h1>Table of Contents</h1>
      <VerticalSparator />
      <HeadingList compact={compact} onClick={handleClick}>
        <ul>
          {numberedHeadings.map((h) => (
            <Heading heading={h} key={h.pos} dragState={dragState} setDragState={setDragState} onDrop={handleDrop} />
          ))}
        </ul>
      </HeadingList>
    </Wrapper>
  );
};

