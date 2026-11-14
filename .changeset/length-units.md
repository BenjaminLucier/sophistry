---
"@sophistry/core": minor
"@sophistry/solidjs": minor
"@sophistry/react": minor
---

Lengths in design pixels. A scene is 1920 design pixels wide (`designWidth`), fixed against `units` when it is made, so a scene unit is 120 px at the defaults. `group` and `text` take `lengthUnit: "px" | "scene"`: a px group's children, strokes and text are sized in pixels while the group's own position stays in its parent's units. Theme defaults (stroke width, font size) keep their scene size inside a px group. `pixelsPerUnitContext` gives the ratio.
