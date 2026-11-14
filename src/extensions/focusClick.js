/**
 * Un clic dans un éditeur sans focus pose le curseur là où l'on clique.
 *
 * Ce qui devrait aller de soi, et qui n'allait pas : on revenait sur le
 * panneau source après avoir agi dans la preview, on cliquait, et toute une
 * zone se retrouvait sélectionnée entre l'ancienne position et le clic.
 *
 * ## Ce que la mesure a montré
 *
 * `handlers.mousedown` de CodeMirror échantillonne la position sous la souris
 * (`basicMouseSelection`), **puis donne le focus au contenu**, puis
 * échantillonne de nouveau dans `select()`. Si les deux mesures diffèrent, il
 * en conclut un glisser-sélectionner et construit une plage.
 *
 * Or donner le focus fait réécrire la sélection du DOM, et le navigateur
 * révèle ce qu'il vient d'écrire : il fait défiler jusqu'au curseur. Quand la
 * vue a été emmenée ailleurs entre-temps -- la synchro du panneau double, un
 * lien de la table des matières, le plan latéral --, ce curseur est loin, et
 * le contenu glisse de plusieurs milliers de pixels entre les deux mesures.
 * Une sonde l'a chiffré : `scrollTop` passant de 4835 à 19415 entre
 * l'enfoncement et la sélection, pour une plage de 4580 à 17003 -- ce dernier
 * nombre étant la position où l'utilisateur avait cliqué une minute plus tôt.
 *
 * ## Le remède
 *
 * Deux gestes, et il a fallu les deux.
 *
 * **Effacer la sélection du DOM**, parce que c'est elle que le navigateur
 * révèle. Tant que l'éditeur n'a pas le focus, CodeMirror ne la réécrit pas :
 * elle est donc restée là où l'utilisateur l'avait laissée, et le navigateur y
 * court avant même que CodeMirror n'ait son mot à dire. Sans range, il n'y a
 * rien à révéler et rien ne défile. Ne poser le curseur que dans l'état de
 * CodeMirror ne suffisait pas -- essayé : la plage devenait seulement plus
 * courte, son ancre juste et sa tête toujours près de l'ancienne position.
 *
 * **Poser le curseur à l'endroit du clic**, pour que la sélection que
 * CodeMirror écrira en recevant le focus soit déjà sous la souris. C'est ce
 * que le clic allait faire de toute façon : on ne fait que l'avancer d'un
 * instant.
 *
 * Les gestionnaires déclarés par un greffon passent avant ceux de CodeMirror
 * (`computeHandlers` ajoute les siens en dernier), ce qui rend cet instant
 * atteignable. On rend `false` pour que CodeMirror fasse ensuite son travail
 * normalement.
 *
 * Laissés de côté : le clic avec Maj, qui étend depuis l'ancre et a donc
 * besoin d'elle ; ceux avec Alt ou Cmd, qui ajoutent un curseur plutôt que
 * d'en déplacer un ; et tout ce qui n'est pas le bouton principal.
 */
import { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";

export const caretFollowsTheClick = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (view.hasFocus || event.button !== 0) return false;
    if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    // Dans une racine d'ombre, la sélection appartient à celle-ci et non au
    // document ; les deux portes sont essayées, dans cet ordre.
    try {
      const root = view.root;
      const domSel = typeof root.getSelection === "function" ? root.getSelection() : view.dom.ownerDocument.getSelection();
      domSel?.removeAllRanges();
    } catch {
      /* une sélection qu'on ne peut pas lire n'a rien à révéler non plus */
    }
    const { anchor, head } = view.state.selection.main;
    if (anchor !== pos || head !== pos) view.dispatch({ selection: EditorSelection.cursor(pos) });
    return false;
  },
});
