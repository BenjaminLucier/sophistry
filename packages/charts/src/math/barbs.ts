/**
 * Wind barb glyphs: a shaft with ticks near one end coding magnitude
 * (pennant 50, full tick 10, half tick 5), built in a local frame (shaft
 * along +x from the origin) for a caller to place, rotate and scale.
 */

import type { Point } from "@sophistry/core/geometry";

/**
 * One barb glyph: how many of each tick it decomposed to, and its geometry.
 *
 * @category Math & helpers
 */
export interface BarbGlyph {
	pennants: number;
	fullBarbs: number;
	halfBarbs: number;
	/** Polylines and polygons in the local frame: the shaft first, then each tick. */
	segments: Point[][];
}

/** @category Math */
export interface BarbGlyphOptions {
	/** Shaft length, local units. @default 1 */
	shaftLength?: number;
	/** Spacing between successive ticks along the shaft. Defaults to `shaftLength / 6`. */
	barbSpacing?: number;
	/** Tick length, local units. Defaults to `shaftLength / 2`. */
	barbLength?: number;
}

const PENNANT_VALUE = 50;
const FULL_BARB_VALUE = 10;
const HALF_BARB_VALUE = 5;
/** Ticks stand off the shaft at the standard meteorological 45°. */
const BARB_ANGLE = Math.PI / 4;

/** Greedy split into pennants (50), full barbs (10) and a half barb (5), after rounding to the nearest 5. */
function decompose(magnitude: number): {
	pennants: number;
	fullBarbs: number;
	halfBarbs: number;
} {
	let units = Math.round(magnitude / HALF_BARB_VALUE) * HALF_BARB_VALUE;
	const pennants = Math.floor(units / PENNANT_VALUE);
	units -= pennants * PENNANT_VALUE;
	const fullBarbs = Math.floor(units / FULL_BARB_VALUE);
	units -= fullBarbs * FULL_BARB_VALUE;
	const halfBarbs = units >= HALF_BARB_VALUE ? 1 : 0;
	return { pennants, fullBarbs, halfBarbs };
}

/**
 * Local-frame geometry for a wind barb: a shaft from the origin to
 * `(shaftLength, 0)` plus ticks stepping in from the far end, each at 45° on
 * the `-y` side. Negative or `NaN` magnitudes draw a bare shaft (calm).
 *
 * @param magnitude - Wind speed in the tick values' units (conventionally knots).
 * @category Math & helpers
 */
export function barbGlyph(
	magnitude: number,
	options: BarbGlyphOptions = {},
): BarbGlyph {
	const shaftLength = options.shaftLength ?? 1;
	const barbSpacing = options.barbSpacing ?? shaftLength / 6;
	const barbLength = options.barbLength ?? shaftLength / 2;

	const speed = Number.isFinite(magnitude) && magnitude > 0 ? magnitude : 0;
	const { pennants, fullBarbs, halfBarbs } = decompose(speed);

	const segments: Point[][] = [
		[
			{ x: 0, y: 0 },
			{ x: shaftLength, y: 0 },
		],
	];

	const dx = Math.cos(BARB_ANGLE) * barbLength;
	const dy = -Math.sin(BARB_ANGLE) * barbLength;

	// Ticks step in from the tip, largest first, so the pennants sit nearest
	// the head of the shaft — the standard reading order.
	let x = shaftLength;
	for (let i = 0; i < pennants; i++) {
		const xBase = x - barbSpacing;
		segments.push([
			{ x, y: 0 },
			{ x: xBase, y: 0 },
			{ x: xBase + dx, y: dy },
			{ x, y: 0 },
		]);
		x = xBase;
	}
	for (let i = 0; i < fullBarbs; i++) {
		segments.push([
			{ x, y: 0 },
			{ x: x + dx, y: dy },
		]);
		x -= barbSpacing;
	}
	if (halfBarbs > 0) {
		segments.push([
			{ x, y: 0 },
			{ x: x + dx / 2, y: dy / 2 },
		]);
	}

	return { pennants, fullBarbs, halfBarbs, segments };
}
