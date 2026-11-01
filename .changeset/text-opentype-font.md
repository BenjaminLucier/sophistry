---
"@sophistry/text": patch
---

`loadFace` now resolves to the exported `OpenTypeFont` type. Its type previously came from a declaration that was not published, so it did not resolve in your project.
