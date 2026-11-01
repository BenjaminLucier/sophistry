/**
 * opentype.js ships no types (2.0.0). The shapes sophistry reads are declared
 * in `opentype-font.ts`; this only types the one function it calls.
 */
declare module "opentype.js" {
	export function parse(
		buffer: ArrayBuffer,
	): import("./opentype-font.js").OpenTypeFont;
}
