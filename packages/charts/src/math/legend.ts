/**
 * Legend layout: where each entry's swatch and label go, given the labels'
 * measured widths. Pure; the `<Legend>` component measures and draws.
 */

import type { Point } from "@sophistry/core/geometry";

/**
 * Options for {@link legendLayout}. Lengths are in scene units.
 *
 * @category Math & helpers
 */
export interface LegendLayoutOptions {
	/** `"column"`: one entry per row, top-down. `"row"`: entries side by side, wrapping at `maxWidth`. */
	direction: "column" | "row";
	/** Height of one row (an entry's line). */
	rowHeight: number;
	/** Width reserved for a swatch. */
	swatchWidth: number;
	/** Space between a swatch and its label. */
	swatchGap: number;
	/** Row direction: space between one entry's label and the next entry's swatch. */
	itemGap: number;
	/**
	 * Row direction: wrap before an entry that would run past this width. Defaults to no wrapping.
	 */
	maxWidth?: number;
	/** Width of a title line above the entries, if there is one. */
	titleWidth?: number;
}

/**
 * One entry, placed. Offsets from the legend's top-left corner, y up (so
 * rows below the first have negative y).
 *
 * @category Math & helpers
 */
export interface LegendItemLayout {
	/** Centre of the swatch. */
	swatch: Point;
	/** Left end of the label, at the row's vertical middle. */
	label: Point;
}

/**
 * A legend, laid out.
 *
 * @category Math & helpers
 */
export interface LegendLayout {
	items: LegendItemLayout[];
	/** Left end of the title line, at its vertical middle; undefined without a title. */
	title?: Point;
	/** Overall width. */
	width: number;
	/** Overall height. */
	height: number;
}

/**
 * Lays a legend out from its labels' widths: swatches in a column (or a
 * wrapping row), each label right of its swatch, an optional title on top.
 *
 * @param widths - Each label's width, in order.
 * @category Math & helpers
 */
export function legendLayout(
	widths: readonly number[],
	options: LegendLayoutOptions,
): LegendLayout {
	const { rowHeight, swatchWidth, swatchGap, itemGap } = options;
	const hasTitle = options.titleWidth !== undefined;
	const top = hasTitle ? rowHeight : 0;
	const items: LegendItemLayout[] = [];
	const entryWidth = (w: number) => swatchWidth + swatchGap + Math.max(0, w);
	let width = hasTitle ? Math.max(0, options.titleWidth ?? 0) : 0;
	let rows = 0;

	if (options.direction === "column") {
		widths.forEach((w, i) => {
			const y = -top - rowHeight * (i + 0.5);
			items.push({
				swatch: { x: swatchWidth / 2, y },
				label: { x: swatchWidth + swatchGap, y },
			});
			width = Math.max(width, entryWidth(w));
		});
		rows = widths.length;
	} else {
		const limit = options.maxWidth ?? Number.POSITIVE_INFINITY;
		let x = 0;
		let row = 0;
		widths.forEach((w, i) => {
			const span = entryWidth(w);
			if (i > 0 && x + span > limit) {
				row += 1;
				x = 0;
			}
			const y = -top - rowHeight * (row + 0.5);
			items.push({
				swatch: { x: x + swatchWidth / 2, y },
				label: { x: x + swatchWidth + swatchGap, y },
			});
			width = Math.max(width, x + span);
			x += span + itemGap;
		});
		rows = widths.length === 0 ? 0 : row + 1;
	}

	return {
		items,
		title: hasTitle ? { x: 0, y: -rowHeight / 2 } : undefined,
		width,
		height: top + rows * rowHeight,
	};
}

/**
 * Options for {@link sizeLegendLayout}. Lengths are in scene units.
 *
 * @category Math & helpers
 */
export interface SizeLegendLayoutOptions {
	/** `"column"`: one circle per row, top-down. `"row"`: side by side, wrapping at `maxWidth`. */
	direction: "column" | "row";
	/** The least height of a row: one line of text. A circle taller than that makes its row taller. */
	rowHeight: number;
	/** Space between a circle and its label. */
	gap: number;
	/** Row direction: space between one entry's label and the next entry's circle. */
	itemGap: number;
	/** Room kept above and below each circle. @default 0 */
	pad?: number;
	/**
	 * Row direction: wrap before an entry that would run past this width. Defaults to no wrapping.
	 */
	maxWidth?: number;
	/** Width of a title line above the entries, if there is one. */
	titleWidth?: number;
}

/**
 * One size-key entry, placed. Offsets from the key's top-left corner, y up.
 *
 * @category Math & helpers
 */
export interface SizeLegendItemLayout {
	/** Centre of the circle. */
	center: Point;
	/** Left end of the label, level with the circle's centre. */
	label: Point;
}

/**
 * A size key, laid out.
 *
 * @category Math & helpers
 */
export interface SizeLegendLayout {
	items: SizeLegendItemLayout[];
	/** Left end of the title line, at its vertical middle; undefined without a title. */
	title?: Point;
	/** Overall width. */
	width: number;
	/** Overall height. */
	height: number;
}

/**
 * Lays a size key out: one reference circle per entry with its value
 * beside it. In a column the circles share one centre line and each row is
 * as tall as its circle; in a row every row is as tall as its tallest entry.
 *
 * @param radii - Each entry's circle radius, in order.
 * @param widths - Each entry's label width, in order.
 * @category Math & helpers
 */
export function sizeLegendLayout(
	radii: readonly number[],
	widths: readonly number[],
	options: SizeLegendLayoutOptions,
): SizeLegendLayout {
	const { rowHeight, gap, itemGap } = options;
	const pad = Math.max(0, options.pad ?? 0);
	const hasTitle = options.titleWidth !== undefined;
	const top = hasTitle ? rowHeight : 0;
	const radius = (i: number) => Math.max(0, radii[i] ?? 0);
	const label = (i: number) => Math.max(0, widths[i] ?? 0);
	const rowOf = (i: number) => Math.max(rowHeight, 2 * radius(i) + 2 * pad);
	const items: SizeLegendItemLayout[] = [];
	let width = hasTitle ? Math.max(0, options.titleWidth ?? 0) : 0;
	let height = top;

	if (options.direction === "column") {
		let slot = 0;
		for (let i = 0; i < radii.length; i++) slot = Math.max(slot, radius(i));
		let y = -top;
		for (let i = 0; i < radii.length; i++) {
			const h = rowOf(i);
			const middle = y - h / 2;
			items.push({
				center: { x: slot, y: middle },
				label: { x: 2 * slot + gap, y: middle },
			});
			width = Math.max(width, 2 * slot + gap + label(i));
			y -= h;
		}
		height = -y;
	} else {
		let tallest = 0;
		for (let i = 0; i < radii.length; i++)
			tallest = Math.max(tallest, rowOf(i));
		const limit = options.maxWidth ?? Number.POSITIVE_INFINITY;
		let x = 0;
		let row = 0;
		for (let i = 0; i < radii.length; i++) {
			const span = 2 * radius(i) + gap + label(i);
			if (i > 0 && x + span > limit) {
				row += 1;
				x = 0;
			}
			const middle = -top - tallest * (row + 0.5);
			items.push({
				center: { x: x + radius(i), y: middle },
				label: { x: x + 2 * radius(i) + gap, y: middle },
			});
			width = Math.max(width, x + span);
			x += span + itemGap;
		}
		height = top + (radii.length === 0 ? 0 : (row + 1) * tallest);
	}

	return {
		items,
		title: hasTitle ? { x: 0, y: -rowHeight / 2 } : undefined,
		width,
		height,
	};
}
