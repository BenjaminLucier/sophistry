/**
 * `@sophistry/text`: LaTeX formulas as scene geometry. KaTeX typesets, and
 * glyphs become outlines the renderer strokes and fills like any shape, so a
 * formula draws on with `progress`, follows the theme and morphs between
 * formulas. Typesetting is async, cached per formula, and skipped on the
 * server.
 *
 * The scene definitions are `mathTex` (a formula, written on with
 * `progress`, coloured per part with `partFill`) and `mathTransform` (a morph
 * between two formulas); `createLatex` is the formula as a `Readable` for
 * per-glyph work. Underneath is the pure pipeline: measure (KaTeX layout read
 * back from the DOM), outline (glyph contours from the KaTeX fonts), place and
 * morph.
 *
 * @module @sophistry/text
 * @packageDocumentation
 */

export type {
	MatchedShapePart,
	MatchShapesOptions,
	ShapeMatch,
	ShapePart,
	ShapeTransform,
} from "@sophistry/core/geometry";
export {
	matchShapesByPointCloud,
	morphShapes,
} from "@sophistry/core/geometry";
export type { FaceName } from "./fonts";
export { ensureWebFonts, KATEX_FAMILIES, loadFace, resolveFace } from "./fonts";
export type {
	Latex,
	LatexHandle,
	LatexOptions,
	LatexStatus,
} from "./latex";
export { createLatex, placeOutline } from "./latex";
export type { MathTexProps, PartFill } from "./math-tex";
export { MathTexNode, mathTex } from "./math-tex";
export type { MathTransformProps } from "./math-transform";
export { MathTransformNode, mathTransform } from "./math-transform";
export type {
	MeasuredAtom,
	MeasuredGlyph,
	MeasuredRule,
	MeasuredSvg,
	Measurement,
	MeasureOptions,
	PixelRect,
} from "./measure";
export { HOST_FONT_SIZE, measureLatex } from "./measure";
export type { LatexMorph, LatexMorphOptions, MorphedPart } from "./morph";
export { crossFade, FADE_STAGGER, morphLatex } from "./morph";
export type { LatexOutline, LatexPart } from "./outline";
export { latexOutline, outlineLatex, partPathData } from "./outline";
export { OUTLINE_RATIO } from "./outline-stroke";
export type { PlacedLatex, PlacedPart } from "./placed";
