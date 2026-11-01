---
title: "API"
description: "The sophistry packages and their entry points. Exact signatures, props and options come with the packages' types, in your editor."
---

Every export is typed and documented with JSDoc in the published packages, so
your editor is the API reference: hover a name for its documentation, and
autocomplete lists a definition's props and an option's allowed values. For
explanations and worked examples, read the [guides](/start/why/) and browse
the [gallery](/gallery/); every chart is listed in the
[chart catalogue](/reference/chart-catalogue/).

## Entry points

Import from the narrowest entry that has what you need: heavy dependencies
(KaTeX, opentype.js, d3's hierarchy layouts) are only bundled when you import
the package that uses them.

| Import | What is in it |
|---|---|
| `@sophistry/core` | 2D scenes without a framework: `createScene`, the definitions (`circle`, `axes`, `label`, ...), groups, layout, tracks (`track`, `derive`, `watch`), clocks, animation verbs and timelines, springs, instancing, interaction, cameras, themes, export, and the custom-definition API |
| `@sophistry/core/geometry` | Pure path, arc, shape, transform, scale, morph, vector-field and graph-layout maths |
| `@sophistry/core/color` | Colour conversion, interpolation, colormaps and ramps |
| `@sophistry/core/themes` | Themes, palettes, colour mode and colormaps |
| `@sophistry/text` | LaTeX as geometry: `mathTex`, `mathTransform`, `createLatex` (pulls in KaTeX and opentype.js) |
| `@sophistry/charts` | Chart definitions (`barChart`, `histogram`, `scatter`, ...) taking `data` plus channels; `chartHandle`; the data-to-geometry maths |
| `@sophistry/charts/3d` | 3D charts (`scatter3D`, `barChart3D`, ...); needs `@sophistry/3d` |
| `@sophistry/3d` | `camera3D`, 3D primitives and plots, projection, `orbitControls3D` |
| `@sophistry/solidjs` | Solid components for every core definition (`<Circle>`, `<Axes>`), `<Stage>`, `<MultiStage>`, `<Camera>`, the hooks (`usePlayer`, `useTrack`, `useTrackValue`, `useMovablePoint`, `useTheme`, ...), `<PanZoom>`, `<SplitScreen>`, `<PictureInPicture>`, `<QuadView>` and `wrap` |
| `@sophistry/solidjs/text`, `/charts`, `/charts/3d`, `/3d` | The components for the text, charts, 3D-charts and 3D definitions (`<MathTex>`, `<BarChart>`, `<Scatter3D>`, `<Camera3D>`), plus `useOrbitControls3D` |
| `@sophistry/react` | The same for React: components, `<Stage>`, `<MultiStage>`, `<Camera>`, hooks and `wrap`; its `/text`, `/charts`, `/charts/3d`, `/3d` subpaths mirror the Solid ones |

The core's `/internal` entry (renderer and plumbing for extension packages) is
unstable: you should not need it.

## Conventions

- **Definitions and components.** Every shape, chart or composite is a
  lowercase definition in its package (`circle`, used with
  `circle.create(props)` and `createScene`) and a PascalCase component in each
  binding (`<Circle>`). Both take the same props, typed as `CircleProps`.
- **Tracks** (`track`, `derive`, `watch`) are `Readable` values: read with
  `peek()`, write with `set()`, and pass them as props to animate.
- **Animations** are functions returning an `Animation`: `draw`, `moveTo`,
  `sequence`, `springTo`, and so on. Run them with `scene.play(...)`, or with
  `usePlayer` in a component.
- **Named options** such as `easing: "backOut"`, `layout: "spring"` or
  `colormap: "viridis"` are closed unions (`EasingName`, `GraphLayoutName`,
  `ColormapName`); any of them also accepts a function.

The core depends on no UI framework. The Solid binding is built on Solid 2.0
(release candidate) and the React binding on React 19. See
[Stability](/project/stability/) for what is covered by the versioning policy.
