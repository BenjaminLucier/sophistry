Generated reference for the **sophistry packages**, built from the JSDoc comments
in the source. This is the place to look up an exact signature, prop or option.
For explanations and worked examples, **start with the guides**:

- New here? Read [Why sophistry](/start/why/), then build the
  [first scene](/start/first-scene/) and skim the [core concepts](/start/concepts/).
- Task-oriented: [shapes and styling](/guides/shapes-and-styling/),
  [animation](/guides/animation/), [interaction](/guides/interaction/),
  [charts](/guides/charts/), [3D](/guides/3d/), [maths and LaTeX](/guides/math-and-latex/).
- Want something to copy? Browse the [gallery](/gallery/): every example links
  back to the API pages of the names it uses.

## Entry points

The core is framework-free TypeScript; text, charts and 3D are separate packages
built on it; the Solid and React bindings wrap all of them. Each entry point is
documented as its own module. Import from the narrowest one that has what you
need: heavy dependencies (KaTeX, opentype.js, d3's hierarchy layouts) are only
bundled when you import the package that uses them. Each module page groups its
members into sections (categories), listed here.

| Import | What is in it | Sections |
|---|---|---|
| [`@sophistry/core`](/api/sophistry/core/readme/) | 2D scenes without a framework: `createScene`, the definitions (`circle`, `axes`, `label`, ...), groups, layout, tracks (`track`, `derive`, `watch`), clocks, animation verbs and timelines, springs, instancing, interaction, cameras, themes, export, and the custom-definition API | [Stage & cameras](/api/sophistry/core/readme/#stage--cameras), [Scene graph](/api/sophistry/core/readme/#scene-graph), [Shapes](/api/sophistry/core/readme/#shapes), [Text & numbers](/api/sophistry/core/readme/#text--numbers), [Coordinate systems & graphs](/api/sophistry/core/readme/#coordinate-systems--graphs), [Layout](/api/sophistry/core/readme/#layout), [Reactivity](/api/sophistry/core/readme/#reactivity), [Tracks & clocks](/api/sophistry/core/readme/#tracks--clocks), [Animation presets](/api/sophistry/core/readme/#animation-presets), [Animation composition & timelines](/api/sophistry/core/readme/#animation-composition--timelines), [Easing](/api/sophistry/core/readme/#easing), [Springs](/api/sophistry/core/readme/#springs), [Instancing](/api/sophistry/core/readme/#instancing), [Interaction](/api/sophistry/core/readme/#interaction), [Accessibility](/api/sophistry/core/readme/#accessibility), [Theming](/api/sophistry/core/readme/#theming), [Colour](/api/sophistry/core/readme/#colour), [Extending](/api/sophistry/core/readme/#extending) |
| [`@sophistry/core/geometry`](/api/sophistry/core/geometry/readme/) | Pure path, arc, shape, transform, scale, morph, vector-field and graph-layout maths | [Paths](/api/sophistry/core/geometry/readme/#paths), [Shapes](/api/sophistry/core/geometry/readme/#shapes), [Transforms](/api/sophistry/core/geometry/readme/#transforms), [Morph](/api/sophistry/core/geometry/readme/#morph), [Morphing & matching](/api/sophistry/core/geometry/readme/#morphing--matching), [Scales & ticks](/api/sophistry/core/geometry/readme/#scales--ticks), [Fields](/api/sophistry/core/geometry/readme/#fields), [Graph layouts](/api/sophistry/core/geometry/readme/#graph-layouts), [Interpolation](/api/sophistry/core/geometry/readme/#interpolation), [Bounds & hit math](/api/sophistry/core/geometry/readme/#bounds--hit-math) |
| [`@sophistry/core/color`](/api/sophistry/core/color/readme/) | Colour conversion, interpolation, colormaps and ramps | One alphabetical list (re-exported from core) |
| [`@sophistry/core/themes`](/api/sophistry/core/themes/readme/) | Themes, palettes, colour mode and colormaps | One alphabetical list (re-exported from core) |
| [`@sophistry/text`](/api/sophistry/text/readme/) | LaTeX as geometry: `mathTex`, `mathTransform`, `createLatex` (pulls in KaTeX and opentype.js) | [Components](/api/sophistry/text/readme/#components), [Fonts](/api/sophistry/text/readme/#fonts), [Morphing & matching](/api/sophistry/text/readme/#morphing--matching), [Measuring & outlines](/api/sophistry/text/readme/#measuring--outlines) |
| [`@sophistry/charts`](/api/sophistry/charts/readme/) | Chart definitions (`barChart`, `histogram`, `scatter`, ...) taking `data` plus channels, batched by default; `chartHandle`; the pure data-to-geometry maths | [Charts](/api/sophistry/charts/readme/#charts), [Channels](/api/sophistry/charts/readme/#channels), [Transforms](/api/sophistry/charts/readme/#transforms), [Math](/api/sophistry/charts/readme/#math), [Extending](/api/sophistry/charts/readme/#extending) |
| [`@sophistry/charts/3d`](/api/sophistry/charts/3d/readme/) | 3D charts (`scatter3D`, `barChart3D`, ...); needs `@sophistry/3d` | [Plots](/api/sophistry/charts/3d/readme/#plots), [Primitives](/api/sophistry/charts/3d/readme/#primitives) |
| [`@sophistry/3d`](/api/sophistry/3d/readme/) | `camera3D`, 3D primitives and plots, projection, `orbitControls3D` | [Camera](/api/sophistry/3d/readme/#camera), [Primitives](/api/sophistry/3d/readme/#primitives), [Plots](/api/sophistry/3d/readme/#plots), [Controls](/api/sophistry/3d/readme/#controls), [Math & helpers](/api/sophistry/3d/readme/#math--helpers), [Extending](/api/sophistry/3d/readme/#extending) |
| [`@sophistry/solidjs`](/api/sophistry/solidjs/readme/) | Solid components for every core definition (`<Circle>`, `<Axes>`), `<Stage>`, `<MultiStage>`, `<Camera>`, the hooks (`usePlayer`, `useTrack`, `useTrackValue`, `useMovablePoint`, `useTheme`, ...), `<PanZoom>`, `<SplitScreen>`, `<PictureInPicture>`, `<QuadView>` and `wrap` | [Stage & cameras](/api/sophistry/solidjs/readme/#stage--cameras), [Tracks & clocks](/api/sophistry/solidjs/readme/#tracks--clocks), [Animation composition & timelines](/api/sophistry/solidjs/readme/#animation-composition--timelines), [Interaction](/api/sophistry/solidjs/readme/#interaction), [Theming](/api/sophistry/solidjs/readme/#theming), [Bindings](/api/sophistry/solidjs/readme/#bindings) |
| [`@sophistry/solidjs/text`](/api/sophistry/solidjs/text/readme/), [`/charts`](/api/sophistry/solidjs/charts/readme/), [`/charts/3d`](/api/sophistry/solidjs/charts/3d/readme/), [`/3d`](/api/sophistry/solidjs/3d/readme/) | The generated components for the text, charts, 3D-charts and 3D definitions (`<MathTex>`, `<BarChart>`, `<Scatter3D>`, `<Camera3D>`), plus `useOrbitControls3D` | One list of components |
| [`@sophistry/react`](/api/sophistry/react/readme/) | The same for React: components, `<Stage>`, `<MultiStage>`, `<Camera>`, hooks and `wrap` (its `/text`, `/charts`, `/charts/3d`, `/3d` subpaths mirror the Solid ones) | [Stage & cameras](/api/sophistry/react/readme/#stage--cameras), [Tracks & clocks](/api/sophistry/react/readme/#tracks--clocks), [Animation composition & timelines](/api/sophistry/react/readme/#animation-composition--timelines), [Interaction](/api/sophistry/react/readme/#interaction), [Theming](/api/sophistry/react/readme/#theming), [Bindings](/api/sophistry/react/readme/#bindings) |

In the sidebar, every module is a collapsed group under **API reference**, named
by its import path. The core's `/internal` entry (renderer and plumbing for
extension packages) is unstable and not documented here: you should not need it.

## Finding things

- **Definitions and components.** A shape, chart or composite is documented
  twice: as a lowercase definition in its source package
  ([`circle`](/api/sophistry/core/variables/circle/), used with
  `circle.create(props)` and `createScene`), and as a generated PascalCase
  component in each binding
  ([`Circle`](/api/sophistry/solidjs/variables/circle/)). The props are the
  same, and `<Name>Props` is linked from both.
- **Browse by category.** Open an entry point's page: its members are grouped
  into the sections above. The sidebar also lists each module's functions,
  classes, interfaces, type aliases and variables alphabetically.
- **Tracks** (`track`, `derive`, `watch`) are `Readable` values: read with
  `peek()`, write with `set()`, and pass them as props to animate.
- **Animations** are functions returning an `Animation`: `draw`, `moveTo`,
  `sequence`, `springTo`, and so on. Run them with `scene.play(...)`, or with
  [`usePlayer`](/api/sophistry/solidjs/functions/useplayer/) in a
  component.
- **Named options** such as `easing: "backOut"`, `layout: "spring"` or
  `colormap: "viridis"` are closed unions (`EasingName`, `GraphLayoutName`,
  `ColormapName`); any of them also accepts a function.
- Every `@example` block in the reference is typechecked as part of the build.

The core depends on no UI framework. The Solid binding is built on Solid 2.0
(release candidate) and the React binding on React 19. See
[Stability](/project/stability/) for what is covered by the versioning policy.
