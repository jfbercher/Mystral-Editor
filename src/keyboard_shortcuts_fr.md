## 5. Raccourcis clavier

`Mod` = Cmd sur macOS, Ctrl ailleurs. Les keymaps de CodeMirror évoluent d'une version à l'autre, donc vérifie les cas limites chez toi.

**Édition** (`defaultKeymap`)

| Touche | Action |
|---|---|
| `Alt-↑` / `Alt-↓` | Déplacer la ligne |
| `Shift-Alt-↑` / `Shift-Alt-↓` | Dupliquer la ligne |
| `Mod-Shift-k` | Supprimer la ligne |
| `Mod-[` / `Mod-]` | Désindenter / indenter |
| `Tab` / `Shift-Tab` | Indenter / désindenter (via `indentWithTab`) |
| `Mod-Enter` | Insérer une ligne vide |
| `Alt-l` | Sélectionner la ligne |
| `Mod-i` | Étendre au nœud syntaxique parent |
| `Mod-/` | Commenter / décommenter |
| `Escape` | Réduire à une sélection simple |

Sur macOS, les liaisons Emacs sont ajoutées (`Ctrl-a`, `Ctrl-e`, `Ctrl-k`, `Ctrl-d`…).

**Recherche et multi-curseur** (`searchKeymap`)

| Touche | Action |
|---|---|
| `Mod-f` | Panneau de recherche |
| `Mod-g` / `Shift-Mod-g` | Occurrence suivante / précédente |
| **`Mod-d`** | **Ajouter l'occurrence suivante à la sélection** |
| **`Mod-Shift-l`** | **Sélectionner toutes les occurrences** (sélection non vide requise) |
| `Mod-Alt-g` | Aller à la ligne |

**Historique**

| Touche | Action |
|---|---|
| `Mod-z` | Annuler |
| `Mod-y` / `Mod-Shift-z` | Refaire |
| `Mod-u` / `Alt-u` | Annuler / refaire la sélection |

**Pliage** (`foldKeymap`)

| Touche | Action |
|---|---|
| `Ctrl-Shift-[` (macOS `Cmd-Alt-[`) | Plier |
| `Ctrl-Shift-]` (macOS `Cmd-Alt-]`) | Déplier |
| `Ctrl-Alt-[` / `Ctrl-Alt-]` | Tout plier / déplier |

**Complétion et lint :** `Ctrl-Space` déclenche, `↑`/`↓` naviguent, `Enter` accepte, `Escape` ferme. `Mod-Shift-m` ouvre le panneau de diagnostics, `F8` va au suivant.