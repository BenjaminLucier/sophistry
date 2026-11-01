/**
 * Helpers the bar family shares: a label placed beside a point, box arithmetic, and the tooltip props a batched node
 * takes. Internal to the family.
 */

import type { Bounds, Placement, Point, Vec2 } from "@sophistry/core";
import { boundsFromCenter, nextTo } from "@sophistry/core";
import { measureLabel } from "@sophistry/core/internal";
import type { TooltipState } from "../tooltip.js";

/**
 * The string whose ink sets every anchored label's height (as core's axes
 * place their numbers): digits, so a row of names shares one baseline.
 */
const LINE_REFERENCE = "0123456789";

/** The metrics style labels are measured in: the label defaults. */
export function labelStyle(fontSize: number, fontFamily: string) {
	return {
		fontSize,
		fontFamily,
		fontWeight: 500,
		italic: false,
		letterSpacing: 0,
	};
}

/**
 * Where a label goes to sit beside `at` (in `direction`, `gap` away) rather
 * than centred on it, measured the same
 * way core's axes place their end labels (the label's own width, one line
 * height per font).
 *
 * @returns The label's `place`.
 */
export function besidePlace(
	text: string,
	at: Point,
	direction: Vec2,
	gap: number,
	fontSize: number,
	fontFamily: string,
): Placement {
	const style = labelStyle(fontSize, fontFamily);
	const { width } = measureLabel(text, style);
	const { ascent, descent } = measureLabel(LINE_REFERENCE, style);
	const halfLine = (ascent + descent) / 2;
	const box: Bounds = {
		minX: -width / 2,
		maxX: width / 2,
		minY: -halfLine,
		maxY: halfLine,
	};
	return nextTo(box, boundsFromCenter(at, 0, 0), direction, { gap });
}

/** A box's centre. */
export function boxCenter(box: Bounds): Point {
	return { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 };
}

/** The box spanned by two corners. */
export function boxOfCorners(a: Point, b: Point): Bounds {
	return {
		minX: Math.min(a.x, b.x),
		maxX: Math.max(a.x, b.x),
		minY: Math.min(a.y, b.y),
		maxY: Math.max(a.y, b.y),
	};
}

/** Whether two boxes are equal field by field. */
export function sameBox(a: Bounds | null, b: Bounds | null): boolean {
	if (a === b) return true;
	if (!a || !b) return false;
	return (
		a.minX === b.minX &&
		a.maxX === b.maxX &&
		a.minY === b.minY &&
		a.maxY === b.maxY
	);
}

/**
 * The interaction props a batched node shares for item tooltips: the
 * handlers when the chart has a tooltip and the mark (or the chart) asks for
 * one, else none.
 */
export function tooltipProps(
	tooltip: TooltipState | null,
	own: unknown,
	handlers: {
		readonly label?: string;
		readonly onEnter?: unknown;
		readonly onLeave?: unknown;
		readonly onTap?: unknown;
		readonly itemLabel?: unknown;
	},
): Record<string, unknown> {
	if (!tooltip || (own === undefined && !tooltip.config())) return {};
	return {
		label: handlers.label,
		onEnter: handlers.onEnter,
		onLeave: handlers.onLeave,
		onTap: handlers.onTap,
		itemLabel: handlers.itemLabel,
	};
}
