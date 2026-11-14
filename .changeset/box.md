---
"@sophistry/box": minor
"@sophistry/core": minor
"@sophistry/solidjs": minor
"@sophistry/react": minor
---

New package `@sophistry/box`: `box` (`<Box>` from `@sophistry/solidjs/box` and `@sophistry/react/box`) lays out text, other boxes and any scene node with flexbox, and paints a background and a border with a width per side and rounded corners. Styles are typed inline objects in design pixels; text properties are handed down to the text inside. In the core, a container can give each child a space of its own (`childSpaceFor`), and text inherits a style from `textStyleContext` and takes `underline` and `strikethrough`.
