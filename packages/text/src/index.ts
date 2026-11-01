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
export type { FaceName } from "./fonts.js";
export {
	ensureWebFonts,
	KATEX_FAMILIES,
	loadFace,
	resolveFace,
} from "./fonts.js";
export type {
	Latex,
	LatexHandle,
	LatexOptions,
	LatexStatus,
} from "./latex.js";
export { createLatex, placeOutline } from "./latex.js";
export type { MathTexProps, PartFill } from "./math-tex.js";
export { MathTexNode, mathTex } from "./math-tex.js";
export type { MathTransformProps } from "./math-transform.js";
export { MathTransformNode, mathTransform } from "./math-transform.js";
export type {
	MeasuredAtom,
	MeasuredGlyph,
	MeasuredRule,
	MeasuredSvg,
	Measurement,
	MeasureOptions,
	PixelRect,
} from "./measure.js";
export { HOST_FONT_SIZE, measureLatex } from "./measure.js";
export type { LatexMorph, LatexMorphOptions, MorphedPart } from "./morph.js";
export { crossFade, FADE_STAGGER, morphLatex } from "./morph.js";
export type { OpenTypeFont } from "./opentype-font.js";
export type { LatexOutline, LatexPart } from "./outline.js";
export { latexOutline, outlineLatex, partPathData } from "./outline.js";
export { OUTLINE_RATIO } from "./outline-stroke.js";
export type { PlacedLatex, PlacedPart } from "./placed.js";
