---
"@sophistry/box": minor
"@sophistry/core": minor
"@sophistry/solidjs": minor
"@sophistry/react": minor
---

New package `@sophistry/box`: `box` (`<Box>` from `@sophistry/solidjs/box` and `@sophistry/react/box`) lays out text, other boxes and any scene node with flexbox or grid (`display: "grid"`, typed track templates and placements), and paints a background and a border with a width per side and rounded corners. Styles are typed inline objects in design pixels; text properties are handed down to the text inside. In the core, a container can give each child a space of its own (`childSpaceFor`), and text inherits a style from `textStyleContext` and takes `underline` and `strikethrough`.

`layoutTo` animates boxes to a new style or new children: every box, text and scene node in the tree moves from its old place to its new one, matched by identity, and the change scrubs and rewinds like any animation. A box lays out again when a scene node inside it changes size; in the core, containers can watch their descendants' geometry (`watchesChildGeometry`, `childGeometryChanged`).
