import * as localUtils from "./utils/local_utils.js";
import { resetBibliography } from "./markdown/bibliography.js"
import MystEditor, { predefinedButtons } from "./MystEditor.jsx";
import { YCommentsParent } from "./components/Comment";
import { effect } from "@preact/signals";
import { h } from "preact";
import { config, configReady, getNewFileTemplate } from "./config.js";

await configReady();


// Styles dynamiques
import codeMirrorCss from "./styles/codemirror-addition.css?inline";
import previewCss from "./styles/preview.css?inline";
import frontmatterCss from "./styles/frontmatter.css?inline";
import footnotesCss from "./styles/footnotes.css?inline";
import bibliographyCss from "./styles/biblio.css?inline";
import editorTabsCss from "./styles/editor-tabs.css?inline";
import pyodideCellsCss from "./styles/pyodide-cells.css?inline";
import katexCss from "katex/dist/katex.min.css?inline";

// WorkingDirectory
import { workingDirectory } from "./utils/local_utils.js";

const previewStyle = localUtils.makeStyleSheet(previewCss);
const frontmatterStyle = localUtils.makeStyleSheet(frontmatterCss);
const codeMirrorStyle = localUtils.makeStyleSheet(codeMirrorCss);
const katexCssPlus = katexCss + `
.eq-numbered { position: relative; padding-right: 3em; }
/* Not flush right: inside an admonition the equation div is a direct child of
   the box and gets none of its padding, so a number at \`right: 0\` sat on the
   border. The inset is taken out of the 3em already reserved on the right, so
   nothing moves but the number itself. */
.eq-number { position: absolute; right: 0.5em; top: 50%; transform: translateY(-50%); }
.katex .eqn-num::before { content: none !important; }
`;
const katexStyle = localUtils.makeStyleSheet(katexCssPlus);
const editorTabsStyle = localUtils.makeStyleSheet(editorTabsCss);
const footnotesStyle = localUtils.makeStyleSheet(footnotesCss);
const bibliographyStyle = localUtils.makeStyleSheet(bibliographyCss);
const pyodideCellsStyle = localUtils.makeStyleSheet(pyodideCellsCss);

const usercolors = ["#30bced", "#60c771", "#e6aa3a", "#cbb63e", "#ee6352", "#9ac2c9", "#8acb88", "#14b2c4"];
const urlParams = new URLSearchParams(window.location.search);
const room = urlParams.get("room") || "0";
const username = urlParams.get("username") || Math.floor(Math.random() * 1000).toString();
const color = usercolors[Math.floor(Math.random() * usercolors.length)];

const collabEnabled = !(import.meta.env.VITE_COLLAB == "OFF") && urlParams.get("collab") != "false";
const collabUrl = import.meta.env.VITE_WS_URL ?? urlParams.get("collab_server");

const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

import * as mystExport from "./utils/local_utils/mystExport.js";
import { showToast } from "./utils/utils_ui.js";


export function makeButtons(tab, getAllEditorIds, updateTabLabel, openFileHandleInTab) {
  // Named rather than picked by index out of defaultButtons: the previous
  // [1,2,3,4,6] silently selected something else whenever that list changed.
  const reducedButtons = [
    predefinedButtons.settings,
    // "Copy document as HTML" and "Print document as pdf" only in the web
    // build. The desktop one has the export menu, which writes real files
    // through myst; on the web these two are the only way to get the document
    // out at all.
    ...(isTauri ? [] : [predefinedButtons.copyHtml, predefinedButtons.printToPdf]),
    // predefinedButtons.refresh — "Refresh issue links" drives the upstream
    // issue-tracker integration, which this fork does not use. Left here
    // rather than deleted, so the button can be brought back if that
    // integration ever is.
    predefinedButtons.suggestMode,
  ];
  return reducedButtons.concat([
    {
      text: h("span", { style: "font-size:1.5em" }, "☀︎/☾"),
      tooltip: "Toggle theme",
      action: async () => await localUtils.toggleEditorTheme(getAllEditorIds),
    },
    {
      id: "recent-files",
      text: h("span", { style: "font-size:1.5em" }, "📂"),
      tooltip: "Open a file",
      action: async () => {
        try {
          const fileHandle = await tab.selectMarkdownFile();
          if (fileHandle) await openFileHandleInTab(fileHandle);
        } catch (err) {
          if (err.name !== "AbortError") console.error("Open file error:", err);
        }
      },
      options: () => tab.getRecentFileOptions(config.recentFilesMax, openFileHandleInTab),
    },
    {
      text: h("span", { style: "font-size:1.5em" }, "📄"),
      tooltip: "New file",
      action: async () => {
        //const response = await fetch("./new_file.md");
        //const newFileTemplate = await response.text();
        const newFileTemplate = getNewFileTemplate();
        tab.setEditorText(newFileTemplate);
        await tab.setSubtitle("a new file");
        await tab.setCurrentFile(null);
        updateTabLabel(tab.editorId);
      },
    },
    {
      id: "save-menu",
      text: h("span", { style: "font-size:1.5em" }, "💾"),
      tooltip: tab.currentFileHandle ? "Save" : "Save as...",
      // Clic direct : Sauvegarde intelligente (Save ou Save As selon l'état)
      action: async () => {
        await tab.smartSave();
      },
      // Menu déroulant au survol / clic secondaire
      options: () => [
        {
          id: "save-simple",
          text: "💾 Save",
          action: async () => {
            await tab.smartSave();
          },
        },
        {
          id: "save-as",
          text: "📝 Save as...",
          action: async () => {
            await tab.saveAs();
          },
        },
        // ----
        {
          id: "make-backup",
          text: "⛑️ Make backup",
          action: async () => {
            await tab.handleBackup(); // Call the function to save the backup();
          },
        },
        // ----
        {
          id: "save-reload",
          text: "🔄 Save and reload",
          action: async () => {
            const saved = await tab.smartSave();
            if (saved) {
              window.location.reload();
            }
          },
        },
        (!isTauri ? {
          id: "save-with-sidecar",
          text: "💾🐍 Save with Python outputs",
          action: async () => { await tab.saveSidecarToFile(); },
        } : null),
      ].filter(Boolean),
    },
    // Export menu — Tauri only: it shells out to `myst`, which the web build
    // cannot do. Hidden entirely elsewhere rather than shown disabled.
    ...(isTauri ? [{
      id: "export-menu",
      text: h("span", { style: "font-size:1.5em" }, "📦"),
      tooltip: "Export / MyST build",
      // Direct click: the most common export.
      action: async () => { await mystExport.exportCurrentFile(tab, "pdf"); },
      options: () => {
        const running = mystExport.siteRunning();
        // Only while the slide view is open: these two act on the deck as it
        // is cut and drawn on screen, and offering them over an ordinary
        // preview would promise something the pane is not showing.
        const inSlides = window.myst_editor?.[tab.editorId]?.state?.options?.mode?.value === "Slides";
        return [
          {
            id: "export-pdf",
            text: "📕 Export PDF",
            action: async () => { await mystExport.exportCurrentFile(tab, "pdf"); },
          },
          {
            id: "export-tex",
            text: "📐 Export LaTeX",
            action: async () => { await mystExport.exportCurrentFile(tab, "tex"); },
          },
          {
            id: "export-docx",
            text: "📘 Export Word (docx)",
            action: async () => { await mystExport.exportCurrentFile(tab, "docx"); },
          },
          {
            id: "export-html",
            text: "🌐 Export HTML (rendered)",
            action: async () => { await mystExport.exportHtml(tab); },
          },
          ...(inSlides
            ? [
                {
                  id: "export-slides-html",
                  // Also the way to a PDF: the exported file opens in the
                  // browser, which prints it as a deck. See docs/slides.md.
                  text: "🖥️ Export slides (HTML)",
                  action: async () => { await mystExport.exportSlides(tab); },
                },
              ]
            : []),
          // ----
          {
            id: "myst-build",
            text: "🏗️ myst build (whole project)",
            action: async () => {
              if (!(await mystExport.hasMystYml(tab))) {
                showToast("No myst.yml in this folder: nothing for myst build to read.", "error", 6000);
                return;
              }
              await mystExport.mystBuild(tab);
            },
          },
          {
            id: "myst-site",
            text: running ? `⏹️ Stop the MyST site` : "🚀 Start the MyST site",
            action: async () => {
              if (mystExport.siteRunning()) {
                await mystExport.stopSite();
                // Through the tab: this menu is built in `makeButtons`, and
                // the function itself lives in `mountEditor`.
                await tab._refreshSiteUrl?.();
                return;
              }
              if (!(await mystExport.hasMystYml(tab))) {
                showToast("No myst.yml in this folder: myst start has no site to serve.", "error", 6000);
                return;
              }
              await mystExport.startSite(tab);
              await tab._refreshSiteUrl?.();
            },
          },
        ];
      },
    }] : []),
    /*{
      text: h("span", { style: "font-size:1.5em" }, "💾"),
      tooltip: "Save file as..",
      action: async () => {
        const content = window.myst_editor[tab.editorId].text;
        if ("showSaveFilePicker" in window) {
          try {
            const handle = await window.showSaveFilePicker({
              suggestedName: tab.currentFileName,
              types: [{ description: "Fichier Markdown", accept: { "text/markdown": [".md"] } }],
            });
            await tab.setCurrentFile(handle);
            const writable = await handle.createWritable();
            await writable.write(content);
            await writable.close();
            updateTabLabel(tab.editorId);
            return;
          } catch (err) {
            if (err.name === "AbortError") return;
          }
        }
        const blob = new Blob([content], { type: "text/markdown;charset=utf-8" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = tab.currentFileName;
        a.click();
        URL.revokeObjectURL(a.href);
      },
    },
    {
      id: "saveAndReload",
      text: h("span", { style: "font-size:1.5em" }, "💾↻"),
      tooltip: "Save document and reload page",
      action: async () => {
        const saved = await tab.saveCurrentDoc();
        if (saved) window.location.reload();
      },
    },
    */
    (!isTauri ? {
        id: "workingDirectory",
        text: h("span", { style: "font-size:1.5em" }, "🗃️"),
        tooltip: "Select working directory",
        action: async () => localUtils.selectWorkingFolder(),
      } : {}),
    {
      id: "stats",
      text: "📊",
      tooltip: "Text statistics",
      action: () => tab.showStatsPopup(),
    },
  ]);
}

export function mountEditor(mnt_options) {
  const { 
    editorId, 
    tab, 
    container, 
    initialContent, 
    editorOptions, 
    getAllEditorIds, 
    updateTabLabel, 
    openFileHandleInTab, 
    openTab,
  } = mnt_options;
  
  /**
   * Point the "MyST site" view at this document's page, or at nothing.
   *
   * Asked for rather than watched: a server starts and stops from the menu
   * here, and those are the only two moments it can change -- plus the
   * editor's own start-up, in case one was already running. `sitePageUrl`
   * answers "" when there is no server or when it serves another project,
   * which is what makes the view's button disappear.
   *
   * "Site" is deliberately absent from `allowedModes` below: a mode restored
   * from the last session must not open on an empty frame.
   */
  const refreshSiteUrl = async () => {
    const opts = window.myst_editor?.[editorId]?.state?.options;
    if (!opts?.siteUrl) return;
    try {
      opts.siteUrl.value = (await mystExport.sitePageUrl?.(tab)) || "";
    } catch (err) {
      console.warn("[site] the page URL could not be computed:", err);
    }
  };

  // Reachable from the tab manager: a tab activated while a site is already
  // running was mounted before it started, so its URL is stale until asked.
  tab._refreshSiteUrl = refreshSiteUrl;

  //type EditorMode = "Source" | "Preview" | "Both" | "Diff" | "Resolved" | "Outline" | "Inline"; // version typeScript
  const allowedModes = ["Source", "Preview", "Both", "Diff", "Resolved", "Outline", "Inline"];
  const storedMode = localStorage.getItem("editorMode");

  // export function mountEditor({ editorId, tab, container, initialContent, editorOptions, getAllEditorIds, updateTabLabel }) {
   MystEditor(
    {
      id: editorId,
      templatelist: "linkedtemplatelist.json",
      initialText: initialContent ?? "",
      title: "[Mystral Editor](https://mystral-editor.readthedocs.io/en/latest/)",
      subtitle: "Template for new files (new_file.md)",
      transforms: editorOptions.transforms ?? [],
      collaboration: {
        enabled: collabEnabled,
        commentsEnabled: collabEnabled,
        resolvingCommentsEnabled: collabEnabled,
        wsUrl: collabUrl ?? "#",
        username,
        room: `${room}-${editorId}`,
        color,
        mode: collabUrl ? "websocket" : "local",
      },
      appKeymap: [
        { key: config.shortcuts.save, preventDefault: true, run: () => { tab.smartSave();  return true; } },
        // Goes through openFileHandleInTab, like the toolbar button: opening
        // straight into this tab is what let the same file end up in two.
        { key: config.shortcuts.open, preventDefault: true, run: () => {
          (async () => {
            const handle = await tab.selectMarkdownFile();
            if (handle) await openFileHandleInTab(handle);
          })().catch((err) => console.error("Open file error:", err));
          return true;
        } },
        { key: config.shortcuts.newTab, preventDefault: true, run: () => { setTimeout(() => openTab(), 0);  return true; } },
      ],
      getBibliographyDirectory: () => localUtils.getWorkingDirectory().value,
      onReady: ({ state }) => {
        // The running site follows the runs. A run is the moment the outputs
        // change, and the only one the editor can see -- an output is not a
        // source, so nothing marks the document as modified. Pushing them is
        // therefore a save, and `tab.autosave()` carries the whole condition
        // on its own: it does nothing unless the user has left autosave on,
        // which is their consent to the editor writing by itself. No setting
        // of our own asks again what has already been answered.
        // What the "MyST site" view points at. Empty unless a server is running
        // for this document's project, which is also what makes the view's
        // button appear at all.
        refreshSiteUrl();

        let followTimer = null;
        const onCellRan = (ev) => {
          if (ev.detail?.owner !== editorId) return;
          // Belt and braces against the hazard above: a tab that has been
          // closed never writes again, whatever reaches its listener.
          if (tab.closed) return;
          if (!mystExport.siteRunning?.() || !tab.autoSaveEnabled) return;
          // `runAllCells` clicks the buttons one after another, so this waits
          // for the series to settle rather than saving once per cell.
          clearTimeout(followTimer);
          followTimer = setTimeout(async () => {
            // Closed while the timer was pending: the handle still points at
            // this tab's file, and the editor it would read from belongs to
            // somebody else by now.
            if (tab.closed) return;
            // `tab.autosave()` would be the obvious call and it is the wrong
            // one: it writes only when the document is dirty, and re-running a
            // cell changes no text -- an output is not a source. Nothing was
            // written, so the watcher never fired and the site stayed a run
            // behind. What is wanted here is precisely a write of a document
            // that has not changed. `autoSaveEnabled` is still the condition,
            // since it is the user's consent to the editor writing by itself;
            // only the action differs.
            try {
              if ((await tab.saveCurrentDoc?.({ interactive: false })) === false) {
                showToast("The site was not updated: the document could not be saved.", "warning", 8000);
              }
            } catch (err) {
              console.warn("[site] the follow-up save failed:", err);
            }
          }, 600);
        };
        // Removed first: onReady runs again when a tab is remounted, and a
        // second listener would save twice. The tab manager removes it for
        // good when the tab closes -- `tab._onCellRan` is the handle it uses,
        // and leaving one behind is not a leak but a hazard: editor ids are
        // reused (`nextAvailableEditorId` returns the lowest free one), so a
        // listener outliving its tab answers for the next tab to take that id,
        // and writes that document's text into this tab's file.
        if (tab._onCellRan) document.removeEventListener("pyodide-cell-ran", tab._onCellRan);
        tab._onCellRan = onCellRan;
        document.addEventListener("pyodide-cell-ran", onCellRan);

        let commentsLoaded = false;
        let loadStarted = false;
        effect(async () => {
          const view = state.editorView.value;
          if (view && !tab.editorReady && !loadStarted) {
            loadStarted = true;
            tab.setEditorReady(false);
            await tab.applyThemeAtStartup();
            await localUtils.applyCustomCss(editorId); 
            await localUtils.loadImageFolderOnStartup();
            await localUtils.loadWorkingFolderOnStartup();
            await localUtils.pruneRecentFileHandlesOnce();

            let rawContent = initialContent || null;
            if (!rawContent) {
              const pathResult = await localUtils.loadFileFromPathParam();
              if (pathResult) {
                tab.setCurrentFilePathParam(pathResult.path);
                rawContent = pathResult.content;
              } else {
                const fileData = await tab.loadFileOnStartup();
                rawContent = fileData ? await fileData.text() : "";
                console.log("File read in onReady");
              }
            }

            if (!rawContent) {
              rawContent = initialContent;
            }


            tab.setEditorText(rawContent);
            updateTabLabel(editorId);
            tab.markSaved(rawContent);
            if (view && !commentsLoaded) {
              commentsLoaded = true;
              await tab.loadCommentsForCurrentFile();
            }
            tab.setEditorReady(true);
            // Here the shadowRoot exists, then 
            effect(() => {
              const shadowRoot = document.getElementById(editorId)?.shadowRoot;
              const subtitle = shadowRoot?.getElementById("document-subtitle");
              if (!subtitle) return;

              const text = tab.subtitleText.value;

              let dirName = "Undefined";
              if (isTauri) {
                const dir = localUtils.currentFileDir.value;
                if (dir) dirName = localUtils.fileName(dir);
              } else {
                const dir = workingDirectory.value;
                if (dir) dirName = typeof dir === 'string' ? localUtils.fileName(dir) : dir.name;
              }

              subtitle.innerHTML = "Editing " + text + "  &emsp; - &emsp;   Working dir: " + dirName;
            });
          }
        });
          effect(() => {
            const currentText = state.text.text.value;
            tab.checkDirty(currentText);
          });
          // Auto-save is a user setting now, not a toolbar button: the toggle
          // is the single source of truth, and each tab follows it.
          effect(() => {
            const setting = state.userSettings.value.find((s) => s.id === "autosave");
            if (setting) tab.autoSaveEnabled = setting.enabled;
          });
          effect(() => {
            const ycomments = state.collab.value?.ycomments;
            if (ycomments) tab.registerYComments(ycomments);
          });
            // Rerender la preview des images et de la biblio quand le workingDirectory change
          effect(() => {
            const dir = workingDirectory.value;
            if (dir) {
              resetBibliography(editorId);
              state.cache.transform.clear();
              state.text.rerender();
            }
          });
      },
      additionalStyles: [codeMirrorStyle, katexStyle, previewStyle, frontmatterStyle, footnotesStyle, bibliographyStyle, pyodideCellsStyle],
      /*mapUrl: (tag, url) => {
            if (tag !== "img") return url;
            
            // Sous Tauri, on résout le chemin immédiatement de façon synchrone
            if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
              const resolved = localUtils.resolveImageSync(url)
              return localUtils.resolveImageSync(url);
            }
            
            // En version Web standard, on conserve l'appel asynchrone
            return localUtils.resolveImage(url);
          },*/
      mapUrl: (tag, url) => {
        if (tag !== "img") return url;
        return localUtils.resolveImage(url); // async, fonctionne pour Tauri et Web
      },
      //mode: "Both", // Source
      // mode: allowedModes.includes(config.editorMode) ? config.editorMode : "Both",
      mode: allowedModes.includes(storedMode)
        ? storedMode
        : allowedModes.includes(config.editorMode)
          ? config.editorMode
          : "Both",
      customRoles: editorOptions.customRoles ?? [],
      customDirectives: editorOptions.customDirectives ?? [],
      includeButtons: makeButtons(tab, getAllEditorIds, updateTabLabel, openFileHandleInTab),
      openFileInTab: openFileHandleInTab,
      spellcheckOpts: { dict: "en_US", dictionaryPath: `${window.location.pathname}dictionaries` },
      syncScroll: true,
    },
    container,
  );
}

