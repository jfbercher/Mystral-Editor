## 5. Keyboard Shortcuts

`Mod` = Cmd on macOS, Ctrl elsewhere. CodeMirror keymaps change from one version to the next, so check for any edge cases on your own system.

**Editing** (`defaultKeymap`)

| Key | Action |
|---|---|
| `Alt-↑` / `Alt-↓` | Move line |
| `Shift-Alt-↑` / `Shift-Alt-↓` | Duplicate line |
| `Mod-Shift-k` | Delete line |
| `Mod-[` / `Mod-]` | Indent / Outdent |
| `Tab` / `Shift-Tab` | Indent / Outdent (via `indentWithTab`) |
| `Mod-Enter` | Insert an empty line |
| `Alt-l` | Select the line |
| `Mod-i` | Expand to parent syntax node |
| `Mod-/` | Comment out / Uncomment |
| `Escape` | Reduce to a single selection |

On macOS, Emacs shortcuts are added (`Ctrl-a`, `Ctrl-e`, `Ctrl-k`, `Ctrl-d`…).

**Search and Multi-Cursor** (`searchKeymap`)

| Key | Action |
|---|---|
| `Mod-f` | Search panel |
| `Mod-g` / `Shift-Mod-g` | Next / Previous occurrence |
| **`Mod-d`** | **Add the next occurrence to the selection** |
| **`Mod-Shift-l`** | **Select all occurrences** (non-empty selection required) |
| `Mod-Alt-g` | Go to line |

**History**

| Key | Action |
|---|---|
| `Mod-z` | Undo |
| `Mod-y` / `Mod-Shift-z` | Redo |
| `Mod-u` / `Alt-u` | Undo / redo selection |

**Folding** (`foldKeymap`)

| Key | Action |
|---|---|
| `Ctrl-Shift-[` (macOS `Cmd-Alt-[`) | Fold |
| `Ctrl-Shift-]` (macOS `Cmd-Alt-]`) | Unfold |
| `Ctrl-Alt-[` / `Ctrl-Alt-]` | Fold All / Unfold All |

**Completion and lint:** `Ctrl-Space` triggers, `↑`/`↓` navigate, `Enter` accepts, `Escape` closes. `Mod-Shift-m` opens the diagnostics panel, `F8` goes to the next item.