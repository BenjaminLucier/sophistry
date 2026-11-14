/**
 * The measure function for fixture words: greedy wrapping of fixed-size
 * boxes, each line as tall as its tallest box, the same rules the
 * generator's inline-blocks follow in Chrome.
 */

import type { MeasureFunction } from "../src/index.js";

const EPSILON = 1e-6;

function wrap(list: [number, number][], limit: number): { height: number } {
	let height = 0;
	let lineWidth = 0;
	let lineHeight = 0;
	for (const [w, h] of list) {
		if (lineWidth > 0 && lineWidth + w > limit + EPSILON) {
			height += lineHeight;
			lineWidth = 0;
			lineHeight = 0;
		}
		lineWidth += w;
		lineHeight = Math.max(lineHeight, h);
	}
	height += lineHeight;
	return { height };
}

export function measureWords(list: [number, number][]): MeasureFunction {
	const minContent = Math.max(0, ...list.map(([w]) => w));
	const maxContent = list.reduce((total, [w]) => total + w, 0);
	return (known, available) => {
		let limit: number;
		if (known.width !== undefined) limit = known.width;
		else if (available.width === "min-content") limit = minContent;
		else if (available.width === "max-content") limit = maxContent;
		else limit = Math.max(minContent, Math.min(available.width, maxContent));
		const size = wrap(list, limit);
		// Fit-content: the width is the limit wrapped at, not the longest line.
		return {
			width: known.width ?? limit,
			height: known.height ?? size.height,
		};
	};
}
