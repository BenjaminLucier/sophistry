---
"@sophistry/text": minor
---

`@sophistry/text` no longer imports KaTeX's stylesheet itself, and `katex` is now a peer dependency. Importing the stylesheet from inside the package broke `import "@sophistry/text"` under plain Node (SSR, tests, scripts) and its types under TypeScript 6+. Install KaTeX alongside it and import the stylesheet once in your app:

```sh
pnpm add katex
```

```ts
// before: nothing (the package imported it)
// after, next to your app's entry point:
import "katex/dist/katex.css";
```

Without the stylesheet formulas are positioned wrong, so the first formula logs a warning when it is missing.
