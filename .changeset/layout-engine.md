---
"@sophistry/layout": minor
---

New package: a flexbox and grid layout engine in plain TypeScript. `computeLayout` takes a tree of CSS-like styles (flex direction, wrapping, grow and shrink, alignment, gaps, margins including `auto`, padding, borders, min and max sizes, aspect ratio, absolute positioning; grid templates with fixed, percentage, `fr`, intrinsic, `minmax`, `fit-content` and repeated tracks including `auto-fill` and `auto-fit`, line and span placement, sparse and dense auto-placement, and item and content alignment) plus measure functions for leaves, and returns every node's box. Behaviour is checked against Chrome through recorded fixtures. No DOM and no dependencies.
