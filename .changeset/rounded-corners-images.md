---
"@sophistry/core": minor
"@sophistry/solidjs": minor
"@sophistry/react": minor
---

Rounded corners are true curves, and `rect` and `square` take `cornerRadii` for a radius per corner (each optionally elliptical, `{ x, y }`); radii too large for the box shrink together, as in CSS. `roundedRectCurvePath` and `resolveCornerRadii` in `@sophistry/core/geometry` build the same outlines. New `image` definition (`<Image>` in the bindings) lays a picture into a box with `objectFit` (`"contain"`, `"cover"`, `"fill"`), and `loadImage` decodes a URL or `Blob` into its pixels.
