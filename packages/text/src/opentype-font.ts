/**
 * The part of an opentype.js font sophistry reads. opentype.js ships no types
 * (2.0.0), and `@types/opentype.js` describes the 1.x API, so these declare the
 * members `fonts.ts` and `outline.ts` actually touch. They live in a module
 * (not only in `opentype.d.ts`) so that `loadFace`'s published type resolves
 * without anything installed beyond this package.
 */

/** A glyph outline. */
export interface OpenTypePath {
	/** SVG path data; `decimalPlaces` defaults to 2. */
	toPathData(decimalPlaces?: number): string;
}

/** One glyph of a font. */
export interface OpenTypeGlyph {
	/** Missing on some glyphs; treat as 0. */
	advanceWidth?: number;
	unicode?: number;
	/** Baseline at `y`, y growing downward — canvas convention. */
	getPath(x: number, y: number, fontSize: number): OpenTypePath;
}

/**
 * A parsed font, as {@link loadFace} resolves it.
 *
 * @category Fonts
 */
export interface OpenTypeFont {
	unitsPerEm: number;
	charToGlyph(char: string): OpenTypeGlyph;
}
