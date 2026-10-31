/**
 * opentype.js ships no types (2.0.0), and `@types/opentype.js` describes the
 * 1.x API. Rather than take a dependency that lies about the version, this
 * declares the four members `fonts.ts` and `outline.ts` actually touch.
 */
declare module "opentype.js" {
	export interface Path {
		/** SVG path data; `decimalPlaces` defaults to 2. */
		toPathData(decimalPlaces?: number): string;
	}

	export interface Glyph {
		/** Missing on some glyphs; treat as 0. */
		advanceWidth?: number;
		unicode?: number;
		/** Baseline at `y`, y growing downward — canvas convention. */
		getPath(x: number, y: number, fontSize: number): Path;
	}

	export interface Font {
		unitsPerEm: number;
		charToGlyph(char: string): Glyph;
	}

	export function parse(buffer: ArrayBuffer): Font;
}
