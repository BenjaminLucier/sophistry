/**
 * A typeset formula's parts, already placed in scene units. Split out from
 * `MathTex.tsx` (where `createLatex` produces them) because
 * `morph.ts` matches parts between two formulas and that is core geometry
 * work, not JSX.
 */

import type { Bounds, Polyline } from "@sophistry/core/geometry";
import type { LatexPart } from "./outline.js";

/**
 * A part with its geometry already in the stage's scene units, y-up.
 *
 * @category Measuring & outlines
 */
export interface PlacedPart {
	/** Where the part came from: a font glyph, a CSS rule (fraction bar), or a stretchy SVG piece. */
	kind: LatexPart["kind"];
	/** Source character; present on glyphs only. */
	char?: string;
	/** Closed contours in scene units. A glyph with a counter has more than one. */
	polylines: Polyline[];
	/** Bounding box of `polylines`, in scene units. */
	box: Bounds;
}

/**
 * A typeset formula centred on the origin, as returned by `createLatex`.
 *
 * @category Measuring & outlines
 */
export interface PlacedLatex {
	/** Drawable pieces in reading order (left to right, then top to bottom). */
	parts: PlacedPart[];
	/** Width of the formula's box, in scene units. */
	width: number;
	/** Height of the formula's box, in scene units. */
	height: number;
}
