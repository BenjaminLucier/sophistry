---
"@sophistry/core": minor
"@sophistry/text": minor
"@sophistry/solidjs": minor
"@sophistry/react": minor
---

One text node for every kind of text. `label` is now `text` (`<Text>`), and it takes strings or spans with their own font, colour, opacity, underline, strikethrough and highlight, breaks at newlines, and wraps at a `width`, with lines broken by Pretext. `textAlign` sets how lines sit in a block. `paragraph` and `wrapText` are gone: use `text` with a `width`, and `layoutText` to lay text out yourself. `bulletedList` items take spans.

Any scene node can sit inside a line of text: `{ inline: node }` among the runs is laid out like one wide glyph, lines break around it, and its line grows to hold it. `mathTex` sits on its own baseline (`textBaseline()`); other nodes are centred on the text or take a `baseline`. `layoutText` takes inline runs (`LayoutInline`), and nodes measure their box in their own units with `ownBounds()`.
