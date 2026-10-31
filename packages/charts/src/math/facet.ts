/**
 * Small multiples: which panel goes where, how big each is, and how a
 * grid of panels reveals. Pure functions behind `<Facet>`, `<PairPlot>` and
 * `<JointPlot>`.
 */

import type { BandKey, Bounds, Point } from "@sophistry/core/geometry";

/** One panel's place in a facet grid. */
export interface FacetSlot {
	/** Reading-order index (row-major). */
	index: number;
	/** Grid row, from the top. */
	row: number;
	/** Grid column, from the left. */
	column: number;
	/** The panel's `row` category, when faceting by rows. */
	rowKey?: BandKey;
	/** The panel's `column` category, when faceting by columns. */
	columnKey?: BandKey;
}

/** The grid {@link facetSlots} lays out. */
export interface FacetSlots {
	slots: FacetSlot[];
	rows: number;
	columns: number;
}

/**
 * Where each panel of a facet grid goes: with both key lists a full grid;
 * with one, a single row (`columnKeys`) or column (`rowKeys`) wrapped after
 * `wrap` panels; with neither, one panel.
 *
 * @param wrap - Panels per line when faceting by one variable.
 */
export function facetSlots(
	rowKeys: readonly BandKey[],
	columnKeys: readonly BandKey[],
	wrap?: number,
): FacetSlots {
	const slots: FacetSlot[] = [];
	if (rowKeys.length > 0 && columnKeys.length > 0) {
		rowKeys.forEach((rowKey, row) => {
			columnKeys.forEach((columnKey, column) => {
				slots.push({ index: slots.length, row, column, rowKey, columnKey });
			});
		});
		return { slots, rows: rowKeys.length, columns: columnKeys.length };
	}
	const line = Math.max(
		1,
		Math.floor(wrap ?? Number.POSITIVE_INFINITY) ||
			Math.max(rowKeys.length, columnKeys.length, 1),
	);
	if (columnKeys.length > 0) {
		const columns = Math.min(line, columnKeys.length);
		columnKeys.forEach((columnKey, i) => {
			slots.push({
				index: i,
				row: Math.floor(i / columns),
				column: i % columns,
				columnKey,
			});
		});
		return { slots, rows: Math.ceil(columnKeys.length / columns), columns };
	}
	if (rowKeys.length > 0) {
		const rows = Math.min(line, rowKeys.length);
		rowKeys.forEach((rowKey, i) => {
			slots.push({
				index: 0,
				row: i % rows,
				column: Math.floor(i / rows),
				rowKey,
			});
		});
		// Reading order is row-major whatever the fill order.
		slots.sort((a, b) => a.row - b.row || a.column - b.column);
		slots.forEach((slot, i) => {
			slot.index = i;
		});
		return { slots, rows, columns: Math.ceil(rowKeys.length / rows) };
	}
	return { slots: [{ index: 0, row: 0, column: 0 }], rows: 1, columns: 1 };
}

/** Whether no panel sits directly below (or above, `"top"`) a slot: it is on the grid's outer edge there. */
export function outerEdge(
	slot: FacetSlot,
	slots: readonly FacetSlot[],
	side: "top" | "bottom" | "left" | "right",
): boolean {
	const dr = side === "top" ? -1 : side === "bottom" ? 1 : 0;
	const dc = side === "left" ? -1 : side === "right" ? 1 : 0;
	return !slots.some(
		(s) => s.row === slot.row + dr && s.column === slot.column + dc,
	);
}

/** Room around a grid or panel, per side, in scene units. */
export interface SideRoom {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

/** Options for {@link facetGrid}. */
export interface FacetGridOptions {
	rows: number;
	columns: number;
	/** The whole footprint's width, in scene units. */
	width: number;
	/** The whole footprint's height. */
	height: number;
	/** The footprint's centre. Defaults to the origin. */
	center?: Point;
	/** Space between neighbouring panels' plotting areas, across a column gap. */
	gapX: number;
	/** Space between neighbouring panels' plotting areas, across a row gap. */
	gapY: number;
	/** Room kept free around the grid of plots, inside the footprint. */
	outer?: Partial<SideRoom>;
	/** Relative column widths. Defaults to equal. */
	widthRatios?: readonly number[];
	/** Relative row heights, top to bottom. Defaults to equal. */
	heightRatios?: readonly number[];
}

/** One cell of a {@link facetGrid}: the plotting area of a panel. */
export interface FacetCell {
	center: Point;
	width: number;
	height: number;
}

/** What {@link facetGrid} returns. */
export interface FacetGrid {
	/** `cells[row][column]`, rows from the top. */
	cells: FacetCell[][];
	/** The box around every plotting area (the grid without its outer room). */
	plots: Bounds;
}

/** The share of `total` each of `n` tracks gets, by ratio. */
function tracks(
	n: number,
	total: number,
	ratios: readonly number[] | undefined,
): number[] {
	const weights = Array.from({ length: n }, (_, i) => {
		const r = ratios?.[i];
		return r !== undefined && Number.isFinite(r) && r > 0 ? r : 1;
	});
	const sum = weights.reduce((a, b) => a + b, 0);
	return weights.map((w) => (Math.max(0, total) * w) / sum);
}

/**
 * Lays out a grid of plotting areas inside a footprint: outer room first,
 * then the gaps, the rest shared between columns and rows by ratio. Each
 * plot keeps at least a tenth of a unit.
 */
export function facetGrid(options: FacetGridOptions): FacetGrid {
	const outer = { left: 0, right: 0, top: 0, bottom: 0, ...options.outer };
	const center = options.center ?? { x: 0, y: 0 };
	const columns = Math.max(1, options.columns);
	const rows = Math.max(1, options.rows);
	const left = center.x - options.width / 2 + outer.left;
	const top = center.y + options.height / 2 - outer.top;
	const innerWidth = Math.max(
		0.1 * columns,
		options.width - outer.left - outer.right - options.gapX * (columns - 1),
	);
	const innerHeight = Math.max(
		0.1 * rows,
		options.height - outer.top - outer.bottom - options.gapY * (rows - 1),
	);
	const widths = tracks(columns, innerWidth, options.widthRatios);
	const heights = tracks(rows, innerHeight, options.heightRatios);
	const cells: FacetCell[][] = [];
	let y = top;
	for (let r = 0; r < rows; r++) {
		const row: FacetCell[] = [];
		let x = left;
		for (let c = 0; c < columns; c++) {
			row.push({
				center: { x: x + widths[c] / 2, y: y - heights[r] / 2 },
				width: widths[c],
				height: heights[r],
			});
			x += widths[c] + options.gapX;
		}
		cells.push(row);
		y -= heights[r] + options.gapY;
	}
	const last = cells[rows - 1][columns - 1];
	return {
		cells,
		plots: {
			minX: left,
			maxX: last.center.x + last.width / 2,
			minY: last.center.y - last.height / 2,
			maxY: top,
		},
	};
}

/**
 * A panel's reveal from the grid's: every panel's frame half at once, then
 * the data half staggered across panels in reading order.
 *
 * @param stagger - Fraction of the data half spent staggering, 0..0.95.
 * @param frameEnd - Where a panel's frame half ends. Defaults to 0.5.
 */
export function panelProgress(
	progress: number,
	index: number,
	count: number,
	stagger = 0,
	frameEnd = 0.5,
): number {
	const p = Math.min(1, Math.max(0, progress));
	const spread = Math.min(0.95, Math.max(0, stagger));
	if (p <= frameEnd || spread === 0 || count <= 1) return p;
	const data = (p - frameEnd) / (1 - frameEnd);
	const delay = (spread * index) / Math.max(1, count - 1);
	const local = Math.min(1, Math.max(0, (data - delay) / (1 - spread)));
	return frameEnd + local * (1 - frameEnd);
}
