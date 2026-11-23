import { useContext } from "preact/hooks";
import styled from "styled-components";
import { MystState } from "../mystState";
import { config } from "../config";
import { openExternalUrl } from "../utils/local_utils/zoom";

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

const Column = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
`;

const Bar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 4px 10px;
  font-size: 12px;
  font-family: "Lato", sans-serif;
  color: var(--gray-500);
  border-bottom: 1px solid var(--border);
  background: var(--panel-bg);

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  button {
    flex: 0 0 auto;
    cursor: pointer;
  }
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

/**
 * The documentation, in the same pane.
 *
 * A second view rather than a second use of the one above: the site and the
 * documentation are two URLs, each with its own mode, so showing one never
 * takes anything from the other -- `myst start` goes on serving while the
 * documentation is read, and the site is one key away again.
 *
 * The address is a configuration key, so a reader who keeps a local build of
 * these pages can point this at it and work offline.
 *
 * A site may refuse to be displayed inside a frame -- `X-Frame-Options`, or a
 * `frame-ancestors` of its own -- and a browser gives no event when it does:
 * the frame simply stays empty, which is indistinguishable from a slow one.
 * Hence the line above it, which costs nothing when the page does appear and
 * is the way out when it does not.
 */
export const HelpPane = () => {
  const url = (config.docsUrl ?? "").trim();

  if (!url) {
    return <Empty>No documentation address is configured: set `docsUrl` in config.json.</Empty>;
  }

  return (
    <Column>
      <Bar>
        <span>{url}</span>
        <button type="button" onClick={() => openExternalUrl(url)}>
          Open in the browser
        </button>
      </Bar>
      <Frame key={url} src={url} title="Documentation" />
    </Column>
  );
};

export default SitePane;
