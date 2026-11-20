import { EditorView } from "@codemirror/view";
import { isTauri, currentFileDir, workingDirectory } from "../utils/local_utils/fs.js";
import { showToast } from "../utils/utils_ui.js";
import { config } from "../config.js";

/**
 * Pasting an image.
 *
 * A clipboard is not a content but a *menu* of representations of one object:
 * a table copied from a spreadsheet arrives as `text/html`, as tab-separated
 * `text/plain` and sometimes as a picture, while a screenshot arrives only as
 * `image/png`. Choosing is choosing the richest representation one can
 * handle, and an image is the only case where the clipboard offers no
 * fallback at all -- without this, a screenshot pasted into a document
 * produced nothing whatever.
 *
 * ## Where the file goes
 *
 * A folder of its own beside the document, `pasted-images` unless
 * `pastedImagesDir` says otherwise. That is not tidiness: it is what makes
 * cleaning up *decidable*. In a folder nothing else writes to, "delete what
 * no document refers to any more" is a question one can answer without risk,
 * while the same sweep over a general images folder would reach files the
 * author put there by hand.
 *
 * The inserted path stays relative to the document, or the export and the
 * site would resolve nothing.
 *
 * ## What undo does, and does not
 *
 * One dispatch, so one Ctrl-Z removes the figure. The file stays: a text
 * editor's undo does not reach the disk. That orphan is unavoidable, and the
 * dedicated folder is what makes it recoverable later rather than a file lost
 * among others.
 */

/** The folder, relative to the document. */
const pastedDir = () => String(config.pastedImagesDir ?? "pasted-images").replace(/^\.?\//, "").replace(/\/+$/, "");

/** The extensions we name a file by, from what the clipboard says it is. */
const EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
  "image/bmp": "bmp",
  "image/tiff": "tif",
};

/**
 * The image a clipboard offers, or null.
 *
 * Read from `items` rather than `files`: a picture copied from a web page is
 * an item with no file behind it, and `files` is then empty while the image
 * is perfectly available.
 */
function imageIn(clipboard) {
  for (const item of clipboard?.items ?? []) {
    if (item.kind !== "file") continue;
    const ext = EXTENSIONS[item.type];
    if (!ext) continue;
    const file = item.getAsFile();
    if (file) return { file, ext };
  }
  return null;
}

/**
 * The name to build the file's own from.
 *
 * A file copied in the Finder or in Explorer arrives with its name, and that
 * name says more than the document's: `diagramme-flux` beats `my-notes`. A
 * screenshot arrives as `image.png` or with no name at all, which says
 * nothing, and the document's name is then the better half of the pair.
 */
function baseName(file, filePath) {
  const own = stemOf(file?.name ?? "");
  // A prefix rather than a whole name: a screenshot saved by the system is
  // called "Capture d-ecran 2026-11-20 a 14.30.12" or "Screenshot 2026-11-20",
  // which is a date and not a subject. The document's name says more.
  const generic = !own || /^(?:image|screen[-_ ]?shot|capture|photo|sans[-_ ]titre|untitled)\b/i.test(own);
  return generic ? stemOf(filePath) : own;
}

/** `20261120-143012`, which sorts by itself and collides with nothing. */
function stamp() {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** The document's name without its extension, for a file name one can read. */
function stemOf(filePath) {
  const name = String(filePath ?? "")
    .replaceAll("\\", "/")
    .split("/")
    .pop();
  // `.myst.md` is one extension as far as a reader is concerned.
  const stem = name.replace(/\.[^.]*$/, "").replace(/\.myst$/i, "").trim();
  // Nothing exotic in a file name: the path travels into the document, into
  // the export and onto a web server, and each of those has its own opinion
  // about spaces and accents.
  const safe = stem
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return safe || "image";
}

/**
 * Write the bytes beside the document, and answer with the relative path.
 *
 * Both builds can write: the desktop through the filesystem plugin, the
 * browser through the working folder's handle when one was chosen. Null when
 * neither is available, and the caller then falls back to a `data:` URL.
 */
async function writeBeside(bytes, name) {
  const dir = pastedDir();
  if (isTauri()) {
    const base = currentFileDir.value;
    if (!base) return null;
    const { mkdir, writeFile } = await import("@tauri-apps/plugin-fs");
    const folder = `${String(base).replace(/\/$/, "")}/${dir}`;
    await mkdir(folder, { recursive: true }).catch(() => {});
    await writeFile(`${folder}/${name}`, bytes);
    return `${dir}/${name}`;
  }

  const wd = workingDirectory.value;
  if (!wd?.getDirectoryHandle) return null;
  let folder = wd;
  for (const part of dir.split("/").filter(Boolean)) {
    folder = await folder.getDirectoryHandle(part, { create: true });
  }
  const handle = await folder.getFileHandle(name, { create: true });
  const stream = await handle.createWritable();
  await stream.write(bytes);
  await stream.close();
  return `${dir}/${name}`;
}

/**
 * The block inserted, and where the caret goes.
 *
 * A `{figure}` rather than a bare `![](…)`: a figure is numbered and
 * referenceable from the moment it exists, which is what a document that
 * counts its figures wants. Its caption is the body, and the caret lands on
 * that empty line -- one has just pasted a picture, and saying what it is is
 * the next thing one does. Left empty, the figure simply has no caption.
 *
 * `:name:` is the file's own stem, which is unique by construction -- a
 * document's name and a timestamp -- so the figure is numbered and
 * referenceable the moment it is pasted, with no thought required. Rename it
 * to something one would willingly type in a `{ref}`, or delete the line; it
 * costs nothing either way.
 *
 * `:alt:` is a placeholder and says so. The only thing available to fill it
 * with would be the file name, and an alternative text reading
 * "my-notes-20261120-143012.png" is worse, for a reader who depends on it,
 * than an honest "Pasted image" asking to be replaced.
 */
function figureBlock(path, label) {
  const head = `:::{figure} ${path}\n` + (label ? `:name: ${label}\n` : "") + `:alt: Pasted image\n`;
  return { text: `${head}\n:::\n`, caret: head.length };
}

export const pasteImage = ({ options }) =>
  EditorView.domEventHandlers({
    paste(event, view) {
      const found = imageIn(event.clipboardData);
      if (!found) return false;
      // Taken over, and said so at once: the decision has to be synchronous,
      // while everything that follows -- reading the blob, writing the file --
      // is not.
      event.preventDefault();

      (async () => {
        const stem = baseName(found.file, options?.filePath?.value);
        const name = `${stem}-${stamp()}.${found.ext}`;
        const bytes = new Uint8Array(await found.file.arrayBuffer());
        let path = null;
        try {
          path = await writeBeside(bytes, name);
        } catch (err) {
          console.warn("[paste] the image could not be written:", err);
        }

        if (!path) {
          // No folder to write to: an unsaved document, or a browser with no
          // working folder. The picture is kept rather than lost, inline in
          // the document, and the reader is told what that costs.
          const url = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.readAsDataURL(found.file);
          });
          showToast(
            `The image was pasted into the document itself: ${
              isTauri() ? "save the document first" : "choose a working folder"
            } to have it written as a file instead.`,
            "warning",
            8000,
          );
          // No label: a `data:` URL is a stopgap, and a reference to it
          // would outlive the stopgap.
          insert(view, figureBlock(url, null));
          return;
        }

        insert(view, figureBlock(path, name.replace(/\.[^.]*$/, "")));
      })();

      return true;
    },
  });

/** One dispatch, so one undo takes it all back. */
function insert(view, { text, caret }) {
  const at = view.state.selection.main;
  view.dispatch({
    changes: { from: at.from, to: at.to, insert: text },
    selection: { anchor: at.from + caret },
    userEvent: "input.paste",
    scrollIntoView: true,
  });
  view.focus();
}
