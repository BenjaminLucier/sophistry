/**
 * Axis-label helpers shared by `numberLine`, `axes` and the charts: the
 * anchored label that sits beside a point, an axis's number formatter, and
 * the room its numbers take. Internal — not in the barrel.
 */

import type { ColorInput } from "../color/index.js";
import type {
	Bounds,
	Matrix,
	Point,
	Range,
	RangeTransition,
} from "../geometry/index.js";
import {
	applyToPoint,
	axisTicks,
	invert,
	isRangeTransition,
	resolveScale,
	resolveTickFormatter,
	tickFormatters,
	tickStep,
} from "../geometry/index.js";
import type { TextHalo } from "../scene/text.js";
import type { Placement, Vec2 } from "../spec/layout.js";
import { boundsFromCenter, nextTo, readDelta } from "../spec/layout.js";
import { measureLabel } from "../spec/metrics.js";
import type { NumberLineProps } from "./number-line.js";

/** Half-length of a major tick — it straddles the line, as Manim's does. */
export const DEFAULT_TICK_SIZE = 0.1;
export const DEFAULT_NUMBER_GAP = 0.14;
export const DEFAULT_NUMBER_FONT_SIZE = 0.3;

/** What decides how an axis writes its numbers. */
export type NumberFormatOptions = Pick<
	NumberLineProps,
	"scale" | "base" | "timeZone" | "step" | "tickFormat"
>;

/**
 * An axis's formatter at range `at`: a format string's precision follows the
 * tick step there (`formatSpecifier`).
 *
 * Internal — not in the barrel; `chart` writes its tooltips' values with it.
 */
export function axisFormatter(options: NumberFormatOptions, at: Range) {
	const span = Math.abs(at[1] - at[0]);
	const step = tickStep(at, { step: options.step });
	return resolveTickFormatter(
		options.tickFormat,
		resolveScale(options.scale, at, options.base, options.timeZone)
			.tickFormat ?? tickFormatters.plain,
		{
			scale: options.scale,
			timeZone: options.timeZone,
			range: at,
			count: span > 0 && step > 0 ? Math.round(span / step) : undefined,
		},
	);
}

/**
 * The options {@link measureAxisNumbers} reads: the ones that decide which
 * numbers an axis writes and how.
 */
export type AxisNumberOptions = NumberFormatOptions &
	Pick<
		NumberLineProps,
		| "numbers"
		| "numbersToInclude"
		| "numbersToExclude"
		| "decimalPlaces"
		| "numberFontSize"
		| "numberGap"
		| "tickSize"
	>;

/** The metrics style axis numbers are measured in: the label defaults. */
export function numberStyle(fontSize: number, fontFamily: string) {
	return {
		fontSize,
		fontFamily,
		fontWeight: 500,
		italic: false,
		letterSpacing: 0,
	};
}

/**
 * How much room an axis's numbers take beside the line, in scene units: the
 * widest number's width and the font's line height, plus the gap the axis
 * leaves before them (`tickSize + numberGap`), as `gap`. Measured over the
 * range's majors — both ends of a transition, so the room doesn't change as
 * it runs. Nothing is thinned, so this is an upper bound. `{ 0, 0, 0 }`
 * when the axis writes no numbers.
 *
 * Internal — not in the barrel; `chart` lays its guides out with it.
 */
export function measureAxisNumbers(
	options: AxisNumberOptions,
	range: Range | RangeTransition,
	fontFamily: string,
): { width: number; height: number; gap: number } {
	if (options.numbers === false) return { width: 0, height: 0, gap: 0 };
	const fontSize = options.numberFontSize ?? DEFAULT_NUMBER_FONT_SIZE;
	const style = numberStyle(fontSize, fontFamily);
	let width = 0;
	const ends = isRangeTransition(range) ? [range.from, range.to] : [range];
	for (const at of ends) {
		const format = axisFormatter(options, at);
		const values =
			options.numbersToInclude ??
			axisTicks(
				resolveScale(options.scale, at, options.base, options.timeZone),
				at,
				{
					step: options.step,
					minorTickCount: 0,
				},
			).majors;
		for (const value of values) {
			if (options.numbersToExclude?.includes(value)) continue;
			width = Math.max(
				width,
				measureLabel(format(value, options.decimalPlaces), style).width,
			);
		}
	}
	if (width === 0) return { width: 0, height: 0, gap: 0 };
	return {
		width,
		height: fontSize * 1.2,
		gap:
			(options.tickSize ?? DEFAULT_TICK_SIZE) +
			(options.numberGap ?? DEFAULT_NUMBER_GAP),
	};
}

/**
 * A box measured in scene-root units (what a handle's `bounds()` reports),
 * brought back into the units of the space whose `matrix` is given.
 *
 * Corner-mapped, so under a rotated space the result is the box's bounding box.
 *
 * @internal Exported for tests.
 */
export function toLocalBounds(
	box: Bounds | null | undefined,
	matrix: Matrix,
): Bounds | null | undefined {
	if (!box) return box;
	const inverse = invert(matrix);
	const a = applyToPoint(inverse, { x: box.minX, y: box.minY });
	const b = applyToPoint(inverse, { x: box.maxX, y: box.maxY });
	return {
		minX: Math.min(a.x, b.x),
		minY: Math.min(a.y, b.y),
		maxX: Math.max(a.x, b.x),
		maxY: Math.max(a.y, b.y),
	};
}

/**
 * The string whose ink sets every anchored label's height: digits, the most
 * common axis text, with the cap height of names that start with a capital.
 */
const LINE_REFERENCE = "0123456789";

/** What an anchored label needs. */
export interface AnchoredLabelOptions {
	text: string;
	/** The point to sit beside, in the enclosing space's units. */
	at: Point;
	direction: Vec2;
	gap: number;
	fontSize: number;
	color: ColorInput;
	zIndex?: number;
	opacity?: number;
	progress?: number;
	/** An outline around the glyphs; see `TextNodeProps.halo`. */
	halo?: boolean | TextHalo;
}

/**
 * Where a label goes to sit *beside* a point rather than centred on it.
 *
 * Goes through `nextTo` rather than a hand-rolled offset because only the
 * text metrics know how wide the string is: the gap between a tick and its
 * number should be the same whether the number is "0" or "-12.5". The box
 * is the label's own, centred on its anchor (a label's default `align` and
 * `baseline`), so the delta `nextTo` returns is directly the position it
 * wants.
 *
 * The box it places is the label's own width but a *line* height shared by
 * every string at that font and size (the ink of {@link LINE_REFERENCE}),
 * not the string's own ink: a label's ink box is centred on its anchor, so a
 * descender ("Apr", "May") made the box taller and pushed the name down by
 * half its depth below a row of names without one ("Jan", "Mar"), and a
 * lowercase name rose. With one height per font, labels placed in a row
 * (category names, numbers) share a baseline; descenders hang into the gap,
 * as in typesetting.
 *
 * Measured directly rather than read off the label's handle: the label sits
 * in the same space as `at`, and its box in its own units is the measured
 * one, so there is nothing to wait for and nothing to convert.
 *
 * @param options - The text, anchor, direction, gap and font size.
 * @param fontFamily - The theme's font family (labels take the theme's).
 * @returns The label's `place`.
 */
export function anchoredLabelPlace(
	options: Pick<
		AnchoredLabelOptions,
		"text" | "at" | "direction" | "gap" | "fontSize"
	>,
	fontFamily: string,
): Placement {
	const style = numberStyle(options.fontSize, fontFamily);
	const { width } = measureLabel(options.text, style);
	const { ascent, descent } = measureLabel(LINE_REFERENCE, style);
	/** Half the shared line height, in this space's units (`fontSize` is in them). */
	const halfLine = (ascent + descent) / 2;
	const box: Bounds = {
		minX: -width / 2,
		maxX: width / 2,
		minY: -halfLine,
		maxY: halfLine,
	};
	return nextTo(box, boundsFromCenter(options.at, 0, 0), options.direction, {
		gap: options.gap,
	});
}

/**
 * `next`, or `previous` when it carries the same offset: an axis whose range
 * animates recomputes every label's anchor, and most land where they were.
 */
export function stablePlace(
	previous: Placement | undefined,
	next: Placement,
): Placement {
	if (!previous) return next;
	const a = readDelta(previous);
	const b = readDelta(next);
	return a.x === b.x && a.y === b.y ? previous : next;
}

/**
 * The `text` props of an anchored label (see {@link anchoredLabelPlace}).
 * Pass the label's current `place` as `previous` when updating a kept one,
 * so an unmoved label keeps its placement object.
 *
 * Internal — deliberately not in the barrel; `axes` reuses it for its end
 * labels, `polarPlane` for its azimuths.
 */
export function anchoredLabelProps(
	options: AnchoredLabelOptions,
	fontFamily: string,
	previous?: Placement,
) {
	return {
		text: options.text,
		place: stablePlace(previous, anchoredLabelPlace(options, fontFamily)),
		fontSize: options.fontSize,
		color: options.color,
		zIndex: options.zIndex,
		opacity: options.opacity,
		progress: options.progress,
		halo: options.halo,
	};
}
