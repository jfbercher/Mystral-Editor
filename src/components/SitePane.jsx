import { useContext } from "preact/hooks";
import styled from "styled-components";
import { MystState } from "../mystState";

/**
 * The page of the running MyST site that shows this document.
 *
 * A viewer of the published rendering, not a second preview: there is no
 * source-to-preview sync here, no click-to-jump, no outline and no comments.
 * What it shows instead is the truth -- the document as mystmd renders it,
 * with its own theme, its cross-document links and, when the document asks
 * for it, cells a reader can re-run. The editor's preview cannot show any of
 * that, and this cannot show what the editor's preview is for.
 *
 * Nothing is refreshed from here: `myst start` watches the file and rebuilds
 * when it changes, and saving is what pushes the current cell outputs (see
 * the export documentation). The only thing this pane does is point at a URL.
 */
const Frame = styled.iframe`
  width: 100%;
  height: 100%;
  border: none;
  background: var(--editor-bg, #fff);
`;

const Empty = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  padding: 2em;
  text-align: center;
  color: var(--gray-500);
  font-family: "Lato", sans-serif;
`;

export const SitePane = () => {
  const { options } = useContext(MystState);
  const url = options.siteUrl.value;

  // Said rather than shown as a blank panel: a frame that never loads looks
  // exactly like a site that is slow, and the difference matters.
  if (!url) {
    return <Empty>Start the MyST site from the 📦 menu to see this document as the site renders it.</Empty>;
  }

  // Keyed by the URL so that changing document reloads the frame rather than
  // leaving the previous page in place.
  return <Frame key={url} src={url} title="MyST site" />;
};

export default SitePane;
