---
"@sophistry/core": minor
"@sophistry/solidjs": minor
"@sophistry/react": minor
---

One text node for every kind of text. `label` is now `text` (`<Text>`), and it takes strings or spans with their own font, colour, opacity, underline, strikethrough and highlight, breaks at newlines, and wraps at a `width`, with lines broken by Pretext. `textAlign` sets how lines sit in a block. `paragraph` and `wrapText` are gone: use `text` with a `width`, and `layoutText` to lay text out yourself. `bulletedList` items take spans.
