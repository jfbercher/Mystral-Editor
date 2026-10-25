import styled, { css } from "styled-components";

/** A right-angle chevron, drawn rather than typeset - the `⌄` and `›` glyphs used by CodeMirror
 * sit at different heights in the font, so as a pair they always look misaligned. Rotating one
 * shape keeps both states identical. Callers set the size and rotate `closed` by -45deg. */
export const FoldChevron = css`
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--editor-gutter-fg);
  cursor: pointer;
  user-select: none;

  &::before {
    content: "";
    width: 4px;
    height: 4px;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: rotate(45deg) translate(-0.75px, -0.75px);
  }
`;

export const MdStyles = css`
  p {
    margin-top: 0px;
    line-height: 1.3em;
    display: block;

    a {
      display: inline;
    }
  }

  a {
    color: var(--accent-dark);
    word-break: break-word;
  }

  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    font-weight: bold;
    line-height: 1.5;
    margin: 1em 0;
  }
  h1 {
    font-size: 1.8em;
  }
  h2 {
    font-size: 1.5em;
  }
  h3 {
    font-size: 1.25em;
  }
  h4 {
    font-size: 1.15em;
  }
  h5 {
    font-size: 1.1em;
  }
  h6 {
    font-size: 1em;
  }

  hr {
    height: 1px;
    margin: 16px 0;
    background-color: var(--gray-500);
    border: 0 none;
  }

  code,
  pre {
    border-radius: var(--border-radius);
    background-color: var(--editor-bg);
  }
  code {
    padding: 0.1em 0.4em;
    font-family: monospace;
    font-size: 0.9em;
    border: none;
  }
  pre {
    white-space: pre-wrap;
    padding: 16px;
    & > code {
      padding: 0px;
    }
  }
  details > summary {
    display: list-item;
    cursor: pointer;
  }


    /* NEW VERSION */
// ============================================================
// ADMONITIONS
// ============================================================

aside.admonition,
details.admonition {
  display: block;
  border-radius: var(--border-radius);
  border: var(--border-2) solid var(--green-500);
  margin-bottom: 16px;

  // Contenu interne
  .admonition {
    margin: 0 22px 14px 22px;
  }

  // Texte
  & > p {
    padding: 10px;
    margin-bottom: 0;
  }

  // ==========================================================
  // HEADER <aside> / SUMMARY <details>
  // ==========================================================

  & > header,
  & > summary.admonition-title {
    padding: 10px;
    color: white;
    font-weight: bold;
    background: var(--green-500);
    display: flex;
    align-items: center;
  }

  // ==========================================================
  // ASIDE
  // ==========================================================

  & > header {
    &::before {
      padding-right: 5px;
      display: flex;
      align-items: center;
    }
  }

  // ==========================================================
  // DETAILS
  // ==========================================================

  & > summary.admonition-title {
    cursor: pointer;
    list-style: none;
     gap: 5px;

    // Firefox / navigateurs modernes
    &::marker {
      display: none;
      content: "";
    }

    // Chrome / Safari
    &::-webkit-details-marker {
      display: none;
    }

    // Chevron
    &::after {
      content: "❯";
      margin-left: auto;
      transition: transform 0.2s ease;
    }
  }

  // Rotation du chevron lorsque <details open>
  &:open > summary.admonition-title::after {
    transform: rotate(90deg);
  }

  // ==========================================================
  // NO ICON
  // ==========================================================


  &.no-icon {
    & > header::before,
    & > summary.admonition-title::before {
      content: none !important;
      display: none !important;
    }
  }

  // ==========================================================
  // NOTE
  // ==========================================================

  &.note {
    border-color: var(--accent);

    & > header,
    & > summary.admonition-title {
      background-color: var(--accent);
    }

    & > header::before,
    & > summary.admonition-title::before {
      content: url("data:image/svg+xml,%3Csvg style='color: white' xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='currentColor' class='bi bi-pencil' viewBox='0 0 16 16'%3E%3Cpath d='M12.146.146a.5.5 0 0 1 .708 0l3 3a.5.5 0 0 1 0 .708l-10 10a.5.5 0 0 1-.168.11l-5 2a.5.5 0 0 1-.65-.65l2-5a.5.5 0 0 1 .11-.168l10-10zM11.207 2.5 13.5 4.793 14.793 3.5 12.5 1.207 11.207 2.5zm1.586 3L10.5 3.207 4 9.707V10h.5a.5.5 0 0 1 .5.5v.5h.5a.5.5 0 0 1 .5.5v.5h.293l6.5-6.5zm-9.761 5.175-.106.106-1.528 3.821 3.821-1.528.106-.106A.5.5 0 0 1 5 12.5V12h-.5a.5.5 0 0 1-.5-.5V11h-.5a.5.5 0 0 1-.468-.325z' fill='white'%3E%3C/path%3E%3C/svg%3E");
      padding-right: 5px;
      margin-right: 15px;
      display: flex;
      align-items: center;
    }
  }

  // ==========================================================
  // WARNING
  // ==========================================================

  &.warning {
    border: 3px solid var(--orange-500);

    & > header,
    & > summary.admonition-title {
      background-color: var(--orange-500);
    }

    & > header::before,
    & > summary.admonition-title::before {
      content: url("data:image/svg+xml,%3Csvg style='color: white' xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='currentColor' class='bi bi-exclamation-triangle' viewBox='0 0 16 16'%3E%3Cpath d='M7.938 2.016A.13.13 0 0 1 8.002 2a.13.13 0 0 1 .063.016.146.146 0 0 1 .054.057l6.857 11.667c.036.06.035.124.002.183a.163.163 0 0 1-.054.06.116.116 0 0 1-.066.017H1.146a.115.115 0 0 1-.066-.017.163.163 0 0 1-.054-.06.176.176 0 0 1 .002-.183L7.884 2.073a.147.147 0 0 1 .054-.057zm1.044-.45a1.13 1.13 0 0 0-1.96 0L.165 13.233c-.457.778.091 1.767.98 1.767h13.713c.889 0 1.438-.99.98-1.767L8.982 1.566z' fill='white'%3E%3C/path%3E%3Cpath d='M7.002 12a1 1 0 1 1 2 0 1 1 0 0 1-2 0zM7.1 5.995a.905.905 0 1 1 1.8 0l-.35 3.507a.552.552 0 0 1-1.1 0L7.1 5.995z' fill='white'%3E%3C/path%3E%3C/svg%3E");
      padding-right: 5px;
      display: flex;
      align-items: center;
    }
  }

  // ==========================================================
  // THEOREM
  // ==========================================================

  /* The theorem-like statements of the proof family: one counter each (see
     PROOF_FAMILY in config-defaults.js), but one and the same box. */
  &.theorem,
  &.corollary,
  &.proposition,
  &.property,
  &.axiom,
  &.conjecture,
  &.observation,
  &.criterion,
  &.assumption {
    border: 3px solid var(--blue-50);

    & > header,
    & > summary.admonition-title {
      background-color: var(--blue-50);
      color: var(--gray-900);
    }

  }


  // ==========================================================
  // EXERCISE
  // ==========================================================

  &.exercise {
    border: 3px solid var(--blue-200);

    & > header,
    & > summary.admonition-title {
      background-color: var(--blue-200);
      color: var(--gray-900);
    }

    & > header::before,
    & > summary.admonition-title::before {
      content: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='currentColor' class='bi bi-pencil-square' viewBox='0 0 16 16'%3E %3Cpath d='M15.502 1.94a.5.5 0 0 1 0 .706L14.459 3.69l-2-2L13.502.646a.5.5 0 0 1 .707 0l1.293 1.293zm-1.75 2.456-2-2L4.939 9.21a.5.5 0 0 0-.121.196l-.805 2.414a.25.25 0 0 0 .316.316l2.414-.805a.5.5 0 0 0 .196-.12l6.813-6.814z'/%3E %3Cpath fill-rule='evenodd' d='M1 13.5A1.5 1.5 0 0 0 2.5 15h11a1.5 1.5 0 0 0 1.5-1.5v-6a.5.5 0 0 0-1 0v6a.5.5 0 0 1-.5.5h-11a.5.5 0 0 1-.5-.5v-11a.5.5 0 0 1 .5-.5H9a.5.5 0 0 0 0-1H2.5A1.5 1.5 0 0 0 1 2.5z'/%3E %3C/svg%3E");
      padding-right: 5px;
      display: flex;
      align-items: center;
    }
  }

    &.solution {
    border: 3px solid var(--blue-100);

    & > header,
    & > summary.admonition-title {
      background-color: var(--blue-100);
      color: var(--gray-900);
    }

    & > header::before,
    & > summary.admonition-title::before {
      content: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' fill='currentColor' class='bi bi-chat-square-dots' viewBox='0 0 16 16'%3E %3Cpath d='M14 1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-2.5a2 2 0 0 0-1.6.8L8 14.333 6.1 11.8a2 2 0 0 0-1.6-.8H2a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1zM2 0a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2.5a1 1 0 0 1 .8.4l1.9 2.533a1 1 0 0 0 1.6 0l1.9-2.533a1 1 0 0 1 .8-.4H14a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2z'/%3E %3Cpath d='M5 6a1 1 0 1 1-2 0 1 1 0 0 1 2 0m4 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0m4 0a1 1 0 1 1-2 0 1 1 0 0 1 2 0'/%3E %3C/svg%3E");
      padding-right: 5px;
      display: flex;
      align-items: center;
    }
  }


  // ==========================================================
  // TIP / HINT
  // ==========================================================

  &.tip,
  &.hint {
    & > header::before,
    & > summary.admonition-title::before {
      content: url("data:image/svg+xml,%3Csvg style='color: white' width='16' height='16' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M7 0V2H8V0H7Z' fill='white'%3E%3C/path%3E%3Cpath d='M3.35355 3.64645L1.85355 2.14645L1.14645 2.85355L2.64645 4.35355L3.35355 3.64645Z' fill='white'%3E%3C/path%3E%3Cpath d='M12.3536 4.35355L13.8536 2.85355L13.1464 2.14645L11.6464 3.64645L12.3536 4.35355Z' fill='white'%3E%3C/path%3E%3Cpath d='M7.49998 3C5.52977 3 3.85938 4.44872 3.58075 6.39913L3.5707 6.46949C3.41148 7.58398 3.73042 8.64543 4.36009 9.45895C4.74345 9.95426 5 10.427 5 10.9013V12.5C5 12.7761 5.22386 13 5.5 13H9.5C9.77614 13 10 12.7761 10 12.5V10.9013C10 10.427 10.2565 9.95423 10.6399 9.45893C11.2696 8.64541 11.5885 7.58397 11.4293 6.4695L11.4192 6.39914C11.1406 4.44873 9.4702 3 7.49998 3Z' fill='white'%3E%3C/path%3E%3Cpath d='M0 8H2V7H0V8Z' fill='white'%3E%3C/path%3E%3Cpath d='M13 8H15V7H13V8Z' fill='white'%3E%3C/path%3E%3Cpath d='M6 15H9V14H6V15Z' fill='white'%3E%3C/path%3E%3C/svg%3E");
      padding-right: 5px;
      display: flex;
      align-items: center;
    }
  }

  // ==========================================================
  // IMPORTANT
  // ==========================================================

  &.important {
    & > header::before,
    & > summary.admonition-title::before {
      content: url("data:image/svg+xml,%3Csvg style='color: white' xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24'%3E%3Cpath d='M18 16v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2zm-5 0h-2v-2h2v2zm0-4h-2V8h2v4zm-1 10c1.1 0 2-.9 2-2h-4c0 1.1.89 2 2 2z' fill='white'%3E%3C/path%3E%3C/svg%3E");
      padding-right: 5px;
      display: flex;
      align-items: center;
    }
  }

  // ==========================================================
  // DIRECTIVE UNHANDLED / ERROR
  // ==========================================================

  &.directive-unhandled,
  &.directive-error {
    margin-bottom: 1em;

    & > header {
      padding: 10px;
      color: white;

      mark {
        background: transparent;
        font-weight: bold;
        color: inherit;
      }

      code {
        background: transparent;
        font-family: "Lato", sans-serif;
        font-weight: bold;
        padding: 0;
        margin-left: 0.3em;
      }
    }

    pre {
      background-color: var(--panel-bg);
      margin: 0;
      font-family: "Lato", sans-serif;
    }
  }

  &.directive-unhandled {
    border: 3px solid var(--gray-700);

    & > header {
      background-color: var(--gray-700);
    }
  }

  &.directive-error {
    border: 3px solid var(--error-bg);

    & > header {
      background-color: var(--error-bg);
    }
  }
}

  // A {raw} block: a literal destined for one output format. Deliberately not
  // under the aside.admonition rule above -- it is not an admonition, and
  // the frame it needs is the opposite of that one's: no alarm, no icon, just
  // the content as it stands and the name of the format it is written for.
  aside.directive-raw {
    margin-bottom: 1em;
    border: 1px solid var(--border);
    border-radius: var(--border-radius);
    overflow: hidden;

    & > header {
      padding: 4px 10px;
      background-color: var(--panel-bg);
      border-bottom: 1px solid var(--border);
      font-size: 0.85em;

      mark {
        background: transparent;
        color: var(--gray-500);
        font-weight: bold;
        letter-spacing: 0.04em;
        text-transform: uppercase;
      }

      code {
        background: transparent;
        padding: 0;
        margin-left: 0.5em;
        color: var(--accent);
        font-weight: bold;
      }
    }

    pre {
      margin: 0;
      border: none;
      border-radius: 0;
      background-color: var(--editor-bg);

      code {
        background: transparent;
        color: var(--tok-comment);
      }
    }
  }

// ============================================================
// CAS PARTICULIER : ANCIENNES ADMONITIONS <aside>
// ============================================================

aside[class="admonition"] {
  .admonition {
    margin-top: 14px;
  }
}
    // END NEW VERSION

  sup,
  sub,
  numref {
    line-height: 0;
  }

  abbr {
    letter-spacing: 0.1em;
    font-weight: bold;
  }

  img {
    max-width: 100%;
    height: auto;
    display: block;
    margin-left: auto;
    margin-right: auto;
  }

  /* Compact lists — match Inline projection (was 40px + 0.5em gaps). */
  li {
    margin: 0;
    line-height: 1.3em;
    p {
      margin: 0;
      padding: 0;
    }
  }
  ul,
  ol {
    list-style: revert;
    list-style-position: outside;
    margin: 0;
    padding-top: 0;
    padding-bottom: 0;
    padding-left: 1.25em;
  }
  ul ul,
  ol ol,
  ul ol,
  ol ul {
    padding-left: 1.5em;
  }
  /* Add a space after the "main" lists without disrupting nested lists. */
  ul,
  ol {
    margin: 0 0 1em;
    padding-left: 1.25em;
  }

  li > ul,
  li > ol {
    margin-bottom: 0;
  }

  blockquote {
    border-left: 5px solid var(--green-500);
    margin-left: 0;
    margin-top: 0;
    padding-left: 12px;
  }

  table {
    border-spacing: 0;
    margin: 20px 0 20px 0;
  }
  th,
  td {
    padding: 20px;
    text-align: left;
    border-right: 1px solid var(--gray-500);
    border-bottom: 1px solid var(--gray-500);
  }
  th {
    /*background: var(--gray-900);*/
    background-color: var(--editor-bg);
    border-top: 1px solid var(--gray-500);
    color: var(--char-col);

    &:first-of-type {
      border-top-left-radius: var(--border-radius);
      border-left: 1px solid var(--gray-500);
    }

    &:last-of-type {
      border-top-right-radius: var(--border-radius);
    }
  }
  td {
    &:first-of-type {
      border-left: 1px solid var(--gray-500);
    }

    p:last-of-type {
      margin-bottom: 0;
    }
  }
  table:not(:has(thead)) > tbody > tr:first-of-type > td {
    border-top: 1px solid var(--gray-500);

    &:first-of-type {
      border-top-left-radius: var(--border-radius);
    }

    &:last-of-type {
      border-top-right-radius: var(--border-radius);
    }
  }
  tr {
    &:nth-child(2n + 2) {
      background: var(--table-br-2);
    }

    &:last-of-type {
      td {
        &:first-of-type {
          border-bottom-left-radius: var(--border-radius);
        }

        &:last-of-type {
          border-bottom-right-radius: var(--border-radius);
        }
      }
    }
  }

  .cm-previewFocus {
    display: ${(props) => (props.mode === "Both" ? "block" : "none")};
  }

  [data-fold] {
    position: relative;
  }

  /* The same marker as in the editor gutter. */
  .myst-fold-arrow {
    ${FoldChevron}
    position: absolute;
    right: 100%;
    margin-right: 4px;
    top: 50%;
    width: 12px;
    height: 12px;
    margin-top: -6px;
    opacity: 0;
  }

  [data-fold]:hover .myst-fold-arrow,
  [data-fold="closed"] .myst-fold-arrow {
    opacity: 1;
  }

  [data-fold="closed"] .myst-fold-arrow::before {
    transform: rotate(-45deg) translate(-0.75px, -0.75px);
  }

  .myst-folded {
    display: none !important;
  }

  /* Folds are a reading aid, a printout should still contain the whole document. */
  @media print {
    .myst-folded {
      display: revert;
    }
  }

  .mermaid {
    background-color: transparent;
    padding: 0;
    display: flex;
    justify-content: center;
  }

  input[type="checkbox"] {
    margin: 0;
    margin-right: 8px;
    /* The default baseline alignment of a form control is engine-dependent
       (WKWebView under Tauri sits lower than Blink), so align on the middle of
       the x-height instead of nudging the baseline by a fixed amount. */
    vertical-align: middle;
  }

  /* A task item carries its own box: drop the list marker, as mystmd does. */
  li:has(> label > input[type="checkbox"]) {
    list-style: none;
  }

  figcaption {
    text-align: center;
    margin-top: 12px;
  }

  // Alignement
  table.align-center {
    width: max-content;
    margin-inline: auto;
  }

  table.align-left {
    width: max-content;
    margin-inline-end: auto;
  }

  table.align-right {
    width: max-content;
    margin-inline-start: auto;
  }

figure.align-left {
  margin-inline: 0 auto;
}

figure.align-right {
  margin-inline: auto 0;
}

figure.align-center {
  margin-inline: auto;
}

img.align-right {
  margin-left: auto;
  margin-right: 0;
}

img.align-left {
  margin-left: 0;
  margin-right: auto;
}

img.align-center {
  margin-left: auto;
  margin-right: auto;
}

  /* highlight.js theme — uses CSS vars for automatic light/dark support */
  .hljs-keyword,
  .hljs-selector-tag,
  .hljs-tag {
    color: var(--tok-keyword);
    font-weight: bold;
  }
  .hljs-string,
  .hljs-doctag,
  .hljs-template-variable,
  .hljs-template-tag {
    color: var(--tok-string);
  }
  .hljs-comment,
  .hljs-quote {
    color: var(--tok-comment);
    font-style: italic;
  }
  .hljs-number,
  .hljs-regexp {
    color: var(--tok-number);
  }
  .hljs-literal {
    color: var(--tok-bool);
  }
  .hljs-title,
  .hljs-title.function_,
  .hljs-title.function_.invoke__,
  .hljs-built_in {
    color: var(--tok-function);
  }
  .hljs-title.class_,
  .hljs-class .hljs-title,
  .hljs-type {
    color: var(--tok-classname);
  }
  .hljs-params {
    color: var(--tok-property);
  }
  .hljs-attr {
    color: var(--accent-dark);
  }
  .hljs-variable,
  .hljs-name {
    color: var(--tok-property);
  }
  .hljs-symbol,
  .hljs-bullet,
  .hljs-meta {
    color: var(--tok-atom);
  }
  .hljs-section {
    color: var(--tok-keyword);
    font-weight: bold;
  }
  .hljs-deletion {
    color: #d73a49;
  }
  .hljs-addition {
    color: #22863a;
  }
  .hljs-emphasis {
    font-style: italic;
  }
  .hljs-strong {
    font-weight: bold;
  }
`;

/**
 * The slide view.
 *
 * A slide is a render chunk -- `splitTextForSlides` cuts the text where the
 * slides are cut -- so the whole view is this stylesheet plus the measurements
 * `slidesView.js` writes as attributes and custom properties. Nothing is
 * moved, which is what lets a cell keep its editor, its output and its kernel
 * while the document is typed.
 *
 * The box is laid out at its nominal size and optically reduced by `scale()`,
 * so text wraps here exactly as it will wrap on the projector. A preview that
 * reflowed to the pane would report an overflow where there is none, or miss
 * one -- which is worse than having no preview.
 */
const SlideStyles = css`
  /* At 100% a slide is scaled to fit and nothing spills sideways; zoomed past
     that it is wider than the pane, which is what the scrollbar is for. */
  overflow-x: auto;

  .slide-zoom-badge {
    position: fixed;
    transform: translateX(-100%);
    z-index: 5;
    padding: 4px 10px;
    border-radius: 999px;
    font-size: 13px;
    font-variant-numeric: tabular-nums;
    color: var(--panel-bg);
    background: var(--icon-color, #555);
    opacity: 0.85;
    pointer-events: none;
  }
  .slide-zoom-badge[hidden] {
    display: none;
  }

  /* The marker opening each slide is the cut itself; a rule across the top of
     every slide would only say so a second time. */
  hr.slide-break {
    display: none;
  }

  /* The fragment marker is a marker, not a rule -- and it was being drawn as
     one, right across the slide. It went unnoticed because it is usually
     pushed out of a box that already overflows: lower the type size until the
     slide fits and the bar appears, which reads as a bug introduced by the
     type size and is in fact the thing that was always there.

     Kept visible while editing, because it says where the reveal happens, but
     drawn as a faint dashed line nobody would take for the document's own
     horizontal rule. Gone the moment the deck is projected, exported or
     printed, where it would only be a line across the slide. */
  hr.fragment-break {
    height: 0;
    border: 0;
    border-top: 1px dashed var(--border);
    opacity: 0.45;
    margin: 0.3em 0;
  }

  &.presenting hr.fragment-break {
    display: none;
  }

  & > html-chunk {
    /* A column, so slides.verticalAlign can place the content in the box.
       Children keep their own widths, and margins no longer collapse between
       them -- which is why the spacing of a slide is a touch airier than the
       same text in the ordinary preview. */
    display: flex;
    flex-direction: column;
    justify-content: var(--slide-align, flex-start);
    position: relative;
    box-sizing: border-box;
    width: var(--slide-w, 1280px);
    height: var(--slide-h, 720px);
    padding: var(--slide-padding, 48px 56px);
    overflow: hidden;
    /* Headings, lists, maths and code are all sized in em, so this one
       declaration sets the scale of the whole slide. 16px is a document; a
       slide is read from the back of a room. slides.fontSize sets it. */
    font-size: var(--slide-font, 28px);
    background: var(--slide-bg, var(--panel-bg));
    border: 1px solid var(--border);
    border-radius: 8px;
    box-shadow: 0 2px 10px var(--box-shadow);
    transform: scale(var(--slide-scale, 1));
    transform-origin: top left;
    /* scale() does not change the space a box takes, so the surplus is taken
       back here: the box occupies its full height in the layout and only its
       scaled height on screen. */
    margin-bottom: calc(var(--slide-h, 720px) * (var(--slide-scale, 1) - 1) + 24px);
  }

  /* While the overflow is being measured: see slidesView.js. */
  &.measuring-slides > html-chunk {
    justify-content: flex-start;
  }

  /* The header and the footer, which are real elements put there by the
     slide view: both pseudo-elements of a slide are already spoken for, and
     the content property carries one string, so a footer with text at left and
     a page number at the right cannot be written that way at all.

     They take part in the column, so they reserve their own space and the
     overflow check counts them -- which is what one wants: a slide that no
     longer fits once it has a footer does not fit. */
  & > html-chunk > .slide-header,
  & > html-chunk > .slide-footer {
    flex: none;
    font-size: 0.6em;
    line-height: 1.3;
    opacity: 0.7;
  }
  & > html-chunk > .slide-header {
    /* padding above the rule, margin below it. */
    padding-bottom: 0.4em;
    margin-bottom: var(--slide-header-push, 0.7em);
  }
  & > html-chunk > .slide-footer {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 1em;
    /* Pinned to the foot whatever the content above it does. */
    margin-top: auto;
    padding-top: 0.4em;
  }
  & > html-chunk > .slide-footer > .slide-footer-page {
    flex: none;
    font-variant-numeric: tabular-nums;
  }

  /* The badge in the corner steps aside when the footer carries the number. */
  & > html-chunk[data-footer-page]::after {
    content: none;
  }

  /* Code cells, which cannot follow the prose on their own.
     Their stylesheet is written in rem -- rooted at the document, not at the
     slide -- so raising slides.fontSize left every cell exactly as small as
     it is in an ordinary preview, code and furniture alike. The variable the
     cell sizes itself from is redefined here, and the pieces that carry their
     own rem value are re-expressed in em so that they follow it. */
  & > html-chunk .pyodide-wrapper {
    --pyodide-cell-font-size: var(--slide-code-font, 18px);
  }
  & > html-chunk .pyodide-btn,
  & > html-chunk .pyodide-param,
  & > html-chunk .pyodide-param-value,
  & > html-chunk .mw-label,
  & > html-chunk .mw-input,
  & > html-chunk .mw-select,
  & > html-chunk .mw-checkbox,
  & > html-chunk .mw-btn {
    font-size: 0.8em;
  }
  & > html-chunk .pyodide-status-text {
    font-size: 0.78em;
  }
  & > html-chunk .pyodide-lang-badge {
    font-size: 0.72em;
  }
  & > html-chunk .pyodide-timing,
  & > html-chunk .pyodide-ran-at,
  & > html-chunk .pyodide-space-tag {
    font-size: 0.68em;
  }
  & > html-chunk .mw-html,
  & > html-chunk .mw-htmlmath,
  & > html-chunk .mw-markdown {
    font-size: 0.9em;
  }

  & > html-chunk::after {
    content: attr(data-slide-index) " / " attr(data-slide-total);
    position: absolute;
    right: 20px;
    bottom: 14px;
    font-size: 18px;
    opacity: 0.35;
    pointer-events: none;
  }

  /* First child of the pane, and sticky: it rides along at the top right
     while the slides scroll under it. Appended last -- the obvious thing --
     it landed below every slide, at the far end of the scroll, which is to
     say nowhere. */
  .slide-present-btn {
    position: sticky;
    top: 0;
    z-index: 4;
    display: block;
    margin: 0 2px 10px auto;
    width: 32px;
    height: 32px;
    border: 1px solid var(--border);
    border-radius: 50%;
    background: var(--button-bg);
    color: inherit;
    font-size: 13px;
    line-height: 1;
    cursor: pointer;
    opacity: 0.55;
  }
  .slide-present-btn:hover {
    opacity: 1;
  }

  /* -- Projecting ---------------------------------------------------------
     One slide, centred, as large as the display allows. The pane covers the
     window on its own, so a browser that refuses the fullscreen request still
     projects properly instead of doing nothing. */
  &.presenting {
    position: fixed;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    overflow: hidden;
    border: 0;
    border-radius: 0;
    box-shadow: none;
    background: var(--panel-bg);
  }

  &.presenting > html-chunk {
    display: none;
    margin: 0;
    transform-origin: center center;
    border: 0;
    border-radius: 0;
    box-shadow: none;
  }
  &.presenting > html-chunk[data-slide-current] {
    display: flex;
    animation-duration: var(--slide-anim-time, 450ms);
    animation-timing-function: cubic-bezier(0.2, 0.7, 0.3, 1);
    /* backwards, not both: forwards would freeze the final frame's computed
       transform, and that transform contains the scale -- so resizing the
       window mid-deck would leave the slide at the size it had when it
       arrived. */
    animation-fill-mode: backwards;
  }

  /* The transitions, and there are deliberately few. A transition says "that
     was a slide, here is another"; anything longer is a thing the room
     watches instead of listening to you.

     Each keyframe carries the scale, because the slide is already scaled by a
     transform and an animation on transform replaces it rather than adding to
     it. Written as a variable, so the entrance is correct at any pane size. */
  @keyframes myst-slide-fade {
    from {
      opacity: 0;
    }
  }
  @keyframes myst-slide-from-right {
    from {
      opacity: 0.3;
      transform: translateX(7%) scale(var(--slide-scale, 1));
    }
  }
  @keyframes myst-slide-from-left {
    from {
      opacity: 0.3;
      transform: translateX(-7%) scale(var(--slide-scale, 1));
    }
  }
  @keyframes myst-slide-from-below {
    from {
      opacity: 0.3;
      transform: translateY(7%) scale(var(--slide-scale, 1));
    }
  }
  @keyframes myst-slide-from-above {
    from {
      opacity: 0.3;
      transform: translateY(-7%) scale(var(--slide-scale, 1));
    }
  }
  @keyframes myst-slide-zoom {
    from {
      opacity: 0.3;
      transform: scale(calc(var(--slide-scale, 1) * 0.94));
    }
  }

  &[data-slide-transition="fade"].presenting > html-chunk[data-slide-current] {
    animation-name: myst-slide-fade;
  }
  &[data-slide-transition="zoom"].presenting > html-chunk[data-slide-current] {
    animation-name: myst-slide-zoom;
  }
  &[data-slide-transition="slide"][data-slide-dir="next"].presenting > html-chunk[data-slide-current] {
    animation-name: myst-slide-from-right;
  }
  &[data-slide-transition="slide"][data-slide-dir="prev"].presenting > html-chunk[data-slide-current] {
    animation-name: myst-slide-from-left;
  }
  &[data-slide-transition="slideUp"][data-slide-dir="next"].presenting > html-chunk[data-slide-current] {
    animation-name: myst-slide-from-below;
  }
  &[data-slide-transition="slideUp"][data-slide-dir="prev"].presenting > html-chunk[data-slide-current] {
    animation-name: myst-slide-from-above;
  }

  /* Someone who asked their system for less movement gets none, whatever the
     deck declares. */
  @media (prefers-reduced-motion: reduce) {
    &.presenting > html-chunk[data-slide-current] {
      animation-name: none;
    }
  }
  &.presenting .slide-present-btn {
    display: none;
  }

  /* The overflow warning is for the author, not for the room. It is the
     editing view's job to say, beforehand, which slides do not fit; once the
     deck is being projected the audience is looking at the slide and the
     warning would only be a red band across it -- and there is nothing to be
     done about it at that point anyway. The border goes with it, for the same
     reason. This also covers the exported deck and its printout, which carry
     the same class. */
  &.presenting > html-chunk[data-slide-overflow] {
    border: 0;
  }
  &.presenting > html-chunk[data-slide-overflow]::before {
    display: none;
  }

  /* Cumulative reveal, without moving or removing anything: what lies past
     the last break passed is made *invisible*, so the slide does not reflow
     under the audience as a list is uncovered. One rule per level; twelve
     fragments on a single slide is already more than anyone should write. */
  & > html-chunk[data-fragment="0"] hr.fragment-break ~ *:not(.slide-header):not(.slide-footer) {
    visibility: hidden;
  }
  & > html-chunk[data-fragment="1"] hr.fragment-break ~ hr.fragment-break ~ *:not(.slide-header):not(.slide-footer) {
    visibility: hidden;
  }
  & > html-chunk[data-fragment="2"] hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ *:not(.slide-header):not(.slide-footer) {
    visibility: hidden;
  }
  & > html-chunk[data-fragment="3"] hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ *:not(.slide-header):not(.slide-footer) {
    visibility: hidden;
  }
  & > html-chunk[data-fragment="4"] hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ *:not(.slide-header):not(.slide-footer) {
    visibility: hidden;
  }
  & > html-chunk[data-fragment="5"] hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ *:not(.slide-header):not(.slide-footer) {
    visibility: hidden;
  }
  & > html-chunk[data-fragment="6"] hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ *:not(.slide-header):not(.slide-footer) {
    visibility: hidden;
  }
  & > html-chunk[data-fragment="7"] hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ *:not(.slide-header):not(.slide-footer) {
    visibility: hidden;
  }
  & > html-chunk[data-fragment="8"] hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ *:not(.slide-header):not(.slide-footer) {
    visibility: hidden;
  }
  & > html-chunk[data-fragment="9"] hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ *:not(.slide-header):not(.slide-footer) {
    visibility: hidden;
  }
  & > html-chunk[data-fragment="10"] hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ *:not(.slide-header):not(.slide-footer) {
    visibility: hidden;
  }
  & > html-chunk[data-fragment="11"] hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ hr.fragment-break ~ *:not(.slide-header):not(.slide-footer) {
    visibility: hidden;
  }

  /* The question the author actually has. A slide is a fixed box and a
     document does not know it is one: this is what says, before the lecture
     rather than during it, which slides do not fit. */
  & > html-chunk[data-slide-overflow] {
    border-color: #c4463a;
  }
  & > html-chunk[data-slide-overflow]::before {
    content: "overflows";
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    padding: 4px 20px;
    font-size: 16px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: #fff;
    background: rgba(196, 70, 58, 0.92);
    text-align: right;
    pointer-events: none;
  }
`;

const Preview = styled.div`
  background-color: var(--panel-bg);
  padding: 20px;
  /* Room to scroll past the end, as a code editor gives.
     The last block of a document could otherwise never be brought anywhere
     but the bottom of the pane: a cell ending the document had its figure cut
     off, and the only remedy was to type blank lines under it. */
  padding-bottom: 40vh;
  box-sizing: border-box;
  height: 100%;
  border: 1px solid var(--border);
  box-shadow: inset 0px 0px 4px var(--box-shadow);
  border-radius: var(--border-radius);
  vertical-align: top;
  word-wrap: break-word;
  position: relative;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: thin;

  ${MdStyles}

  ${(props) => props.mode === "Slides" && SlideStyles}

  @media print {
    & {
      display: block !important;
      border: 0px !important;
      box-shadow: none !important;
      border-radius: 0px !important;
      word-break: unset !important;
      /* The scroll-past-end room is for scrolling, not for paper. */
      padding-bottom: 20px !important;
    }

    /* On paper everything is there at once. A reveal that survived into the
       printed copy would hand out slides carrying their first third only --
       and it is the kind of omission one discovers after distributing the
       file. */
    html-chunk[data-fragment] hr.fragment-break ~ * {
      visibility: visible !important;
    }

    /* Note: printing a deck is NOT done from here. A stylesheet inside a
       shadow root cannot select anything outside it, so a rule hung on a
       class put on <html> matches nothing -- and printing then falls back to
       the screen layout, which clips the output to one screenful. The deck is
       printed from a copy placed in the page's own document; see
       utils/local_utils/mystExport.js. */

    /* Controls are for the screen. */
    .slide-present-btn,
    .slide-zoom-badge {
      display: none !important;
    }

    p {
      break-inside: avoid !important;
      text-align: justify !important;
      text-justify: inter-word !important;
    }

    a::after {
      content: "(" attr(href) ")" !important;
    }
  }
`;

export const PreviewFocusHighlight = styled.div`
  position: absolute;
  width: 5px;
  background-color: var(--accent);
`;

export default Preview;
