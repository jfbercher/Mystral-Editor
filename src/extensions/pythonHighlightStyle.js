import { HighlightStyle } from "@codemirror/language";
import { tags } from "@lezer/highlight";

/**
 * Style de coloration syntaxique Python utilisant les variables CSS du thème
 * (--tok-keyword, --tok-string, etc.), ce qui assure la compatibilité
 * automatique avec le mode clair et le mode sombre.
 */
export const pythonHighlightStyle = HighlightStyle.define([
  { tag: tags.keyword,                        color: "var(--tok-keyword)" },
  { tag: tags.operator,                        color: "var(--tok-operator)" },
  { tag: tags.number,                          color: "var(--tok-number)" },
  { tag: [tags.bool, tags.null],               color: "var(--tok-bool)" },
  { tag: tags.string,                          color: "var(--tok-string)" },
  { tag: tags.special(tags.string),            color: "var(--tok-string)" },
  { tag: tags.comment,                         color: "var(--tok-comment)", fontStyle: "italic" },
  { tag: tags.definition(tags.variableName),   color: "var(--tok-function)" },
  { tag: tags.function(tags.variableName),     color: "var(--tok-function)" },
  { tag: tags.function(tags.propertyName),     color: "var(--tok-function)" },
  { tag: tags.className,                       color: "var(--tok-classname)" },
  { tag: [tags.typeName, tags.namespace],      color: "var(--tok-classname)" },
  { tag: tags.self,                            color: "var(--tok-self)" },
  { tag: tags.atom,                            color: "var(--tok-atom)" },
  { tag: tags.propertyName,                    color: "var(--tok-property)" },
  { tag: tags.variableName,                    color: "var(--tok-property)" },
  { tag: tags.punctuation,                     color: "var(--tok-operator)" },
  { tag: tags.special(tags.variableName),      color: "var(--tok-property)" },
]);
