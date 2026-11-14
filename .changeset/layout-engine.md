---
"@sophistry/layout": minor
---

New package: a flexbox layout engine in plain TypeScript. `computeLayout` takes a tree of CSS-like styles (flex direction, wrapping, grow and shrink, alignment, gaps, margins including `auto`, padding, borders, min and max sizes, aspect ratio, absolute positioning) plus measure functions for leaves, and returns every node's box. Behaviour is checked against Chrome through recorded fixtures. No DOM and no dependencies.
