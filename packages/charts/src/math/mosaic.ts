import { clampNonNegative } from "@sophistry/core/internal";
/**
 * Mosaic (Marimekko) layout: a two-way table as columns as wide as each
 * column's share of the whole, split into segments as tall as each row's
 * share within the column.
 */

/**
 * A category of a mosaic's columns or rows: a string or a number.
 *
 * @category Math & helpers
 */
export type MosaicKey = string | number;

/**
 * One entry of the long-form table a mosaic lays out.
 *
 * @category Math & helpers
 */
export interface MosaicInput {
	/** Column category. */
	x: MosaicKey;
	/** Row (segment) category. */
	y: MosaicKey;
	/** Amount; negative and non-finite values count as 0. */
	value: number;
}

/** @category Math */
export interface MosaicOptions {
	/**
	 * Column order: listed keys first, then unlisted ones in first-seen order. Defaults to
	 * first-seen order.
	 */
	columns?: readonly MosaicKey[];
	/** Row (segment) order, bottom first; same rules as `columns`. Defaults to first-seen order. */
	rows?: readonly MosaicKey[];
	/** Width of the layout box. @default 1 */
	width?: number;
	/** Height of the layout box. @default 1 */
	height?: number;
	/**
	 * Gap between neighbouring columns, and between segments in a column;
	 * capped at half the box's width (or height) in total.
	 * @default 0
	 */
	padding?: number;
}

/**
 * One laid-out column of a mosaic, in the layout box.
 *
 * @category Math & helpers
 */
export interface MosaicColumn {
	/** The column's category. */
	key: MosaicKey;
	/** Place among the drawn columns, left to right, 0-based. */
	index: number;
	/** Left edge. */
	x0: number;
	/** Right edge. */
	x1: number;
	/** Sum of the column's values. */
	value: number;
	/** The column's share of the grand total, 0..1. */
	share: number;
	/** Index of the first input entry with a positive value in the column. */
	dataIndex: number;
}

/**
 * One laid-out segment of a mosaic: a rectangle in the layout box, **y
 * pointing down** (0 is the top edge).
 *
 * @category Math & helpers
 */
export interface MosaicRect {
	/** The column's category. */
	column: MosaicKey;
	/** The row's category. */
	row: MosaicKey;
	/** The column's place among the drawn columns, 0-based. */
	columnIndex: number;
	/** The row's place in {@link MosaicLayout.rows}, 0-based (stable across columns, for colour). */
	rowIndex: number;
	x0: number;
	y0: number;
	x1: number;
	y1: number;
	/** Sum of the values for this (column, row) pair. */
	value: number;
	/** The column's share of the grand total, 0..1 (the rectangle's width share). */
	columnShare: number;
	/** The segment's share of its column, 0..1 (its height share). */
	rowShare: number;
	/** Index of the first input entry with a positive value for this pair. */
	dataIndex: number;
}

/**
 * A mosaic laid out: see {@link mosaicLayout}.
 *
 * @category Math & helpers
 */
export interface MosaicLayout {
	/** Columns with a positive total, left to right. */
	columns: MosaicColumn[];
	/** Segments with a positive value, column by column, bottom to top. */
	rects: MosaicRect[];
	/** Every row category, in row order (including rows with no positive value). */
	rows: MosaicKey[];
	/** Sum of every value. */
	total: number;
}

/** Listed keys first (those present), then the rest in first-seen order. */
function orderKeys(
	seen: readonly MosaicKey[],
	listed: readonly MosaicKey[] | undefined,
): MosaicKey[] {
	if (!listed) return [...seen];
	const present = new Set(seen);
	const out: MosaicKey[] = [];
	const placed = new Set<MosaicKey>();
	for (const key of listed) {
		if (present.has(key) && !placed.has(key)) {
			out.push(key);
			placed.add(key);
		}
	}
	for (const key of seen) if (!placed.has(key)) out.push(key);
	return out;
}

/** Adds `value` to a running sum; the first positive entry becomes its datum. */
function add(
	sum: { value: number; dataIndex: number },
	value: number,
	index: number,
): void {
	if (sum.value === 0 && value > 0) sum.dataIndex = index;
	sum.value += value;
}

/** A positive finite size, or the fallback. */
function size(value: number | undefined, fallback: number): number {
	return value !== undefined && Number.isFinite(value)
		? Math.max(0, value)
		: fallback;
}

/** The gap between `count` parts of `span`, capped at half the span in total. */
function gapFor(padding: number, span: number, count: number): number {
	if (count <= 1) return 0;
	return Math.min(padding, (span * 0.5) / (count - 1));
}

/**
 * Lays out a mosaic from a long-form `{ x, y, value }` table: column widths
 * by share of the total, segments stacked bottom-up in row order by share
 * of their column, so areas are proportional to values. Duplicate pairs
 * sum; nothing-positive columns and segments get no rectangle or gap. The
 * box has **y pointing down**.
 *
 * @returns Columns, segment rectangles, row order and total; empty when nothing is positive.
 * @category Math & helpers
 */
export function mosaicLayout(
	cells: readonly MosaicInput[],
	options: MosaicOptions = {},
): MosaicLayout {
	const width = size(options.width, 1);
	const height = size(options.height, 1);
	const padding = Math.max(0, options.padding ?? 0) || 0;

	const seenColumns: MosaicKey[] = [];
	const seenRows: MosaicKey[] = [];
	const columnSeen = new Set<MosaicKey>();
	const rowSeen = new Set<MosaicKey>();
	/** column → row → { value, first index } */
	const table = new Map<
		MosaicKey,
		Map<MosaicKey, { value: number; dataIndex: number }>
	>();
	const columnTotal = new Map<
		MosaicKey,
		{ value: number; dataIndex: number }
	>();
	let total = 0;

	cells.forEach((cell, index) => {
		const { x, y } = cell;
		if (!columnSeen.has(x)) {
			columnSeen.add(x);
			seenColumns.push(x);
		}
		if (!rowSeen.has(y)) {
			rowSeen.add(y);
			seenRows.push(y);
		}
		const value = clampNonNegative(cell.value);
		let row = table.get(x);
		if (!row) {
			row = new Map();
			table.set(x, row);
		}
		const entry = row.get(y);
		if (entry) add(entry, value, index);
		else row.set(y, { value, dataIndex: index });
		const sum = columnTotal.get(x);
		if (sum) add(sum, value, index);
		else columnTotal.set(x, { value, dataIndex: index });
		total += value;
	});

	const rows = orderKeys(seenRows, options.rows);
	const empty: MosaicLayout = { columns: [], rects: [], rows, total: 0 };
	if (!(total > 0) || !Number.isFinite(total)) return empty;

	const drawn = orderKeys(seenColumns, options.columns).filter(
		(key) => (columnTotal.get(key)?.value ?? 0) > 0,
	);
	const columnGap = gapFor(padding, width, drawn.length);
	const columnSpan = width - columnGap * Math.max(0, drawn.length - 1);

	const columns: MosaicColumn[] = [];
	const rects: MosaicRect[] = [];
	let x = 0;
	drawn.forEach((key, columnIndex) => {
		const sum = columnTotal.get(key) as { value: number; dataIndex: number };
		const share = sum.value / total;
		const x0 = x;
		const x1 =
			columnIndex === drawn.length - 1 ? width : x0 + share * columnSpan;
		x = x1 + columnGap;
		columns.push({
			key,
			index: columnIndex,
			x0,
			x1,
			value: sum.value,
			share,
			dataIndex: sum.dataIndex,
		});

		const byRow = table.get(key) as Map<
			MosaicKey,
			{ value: number; dataIndex: number }
		>;
		const segments = rows.flatMap((row, rowIndex) => {
			const entry = byRow.get(row);
			return entry && entry.value > 0 ? [{ row, rowIndex, ...entry }] : [];
		});
		const rowGap = gapFor(padding, height, segments.length);
		const rowSpan = height - rowGap * Math.max(0, segments.length - 1);
		let bottom = height;
		segments.forEach((segment, k) => {
			const rowShare = segment.value / sum.value;
			const y1 = bottom;
			const y0 = k === segments.length - 1 ? 0 : y1 - rowShare * rowSpan;
			bottom = y0 - rowGap;
			rects.push({
				column: key,
				row: segment.row,
				columnIndex,
				rowIndex: segment.rowIndex,
				x0,
				y0,
				x1,
				y1,
				value: segment.value,
				columnShare: share,
				rowShare,
				dataIndex: segment.dataIndex,
			});
		});
	});

	return { columns, rects, rows, total };
}
