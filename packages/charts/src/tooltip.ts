/**
 * Chart tooltips, the state half: what a tooltip shows (rows, templates,
 * formats), which datum is showing, the handlers marks attach, and the
 * shared nearest-x mode's points. The panel itself is drawn by the chart
 * (`frame/tooltip-overlay.ts`).
 *
 * A chart provides one {@link TooltipState} through {@link tooltipContext};
 * marks read it with `ctx.context(tooltipContext)`.
 */

import type { ContextKey, Readable, ScenePointerEvent } from "@sophistry/core";
import { createContextKey, track } from "@sophistry/core";
import type { BandKey, Bounds, Point } from "@sophistry/core/geometry";
import { formatTick } from "@sophistry/core/geometry";
import { lowerBound } from "./util";

/** Gap between a tooltip panel and the point it describes, scene units. */
export const TIP_GAP = 0.18;

/**
 * One line of a tooltip: a channel's name and its formatted value.
 *
 * @category Charts
 */
export interface TooltipRow {
	/** The channel the value comes from (`"x"`, `"y"`, `"series"`, `"size"`, `"value"`, …); `"text"` for a sentence. */
	channel: string;
	/** The row's name: the field's name when the channel is a key of the datum, else the channel's. Empty for none. */
	name: string;
	/** The value, formatted. */
	value: string;
	/** The value before formatting, when there is one. */
	raw?: number | BandKey;
	/** A swatch drawn before the row: the datum's series colour. */
	color?: string;
}

/**
 * What a tooltip shows: one line of text (`\n` breaks it), or rows of names
 * and values in two columns.
 *
 * @category Charts
 */
export type TooltipContent = string | readonly TooltipRow[];

/**
 * Per-channel formatters replacing the chart's own, keyed by channel
 * (`{ y: (v) => `$${v}` }`). A band axis's value is its category key.
 *
 * @category Charts
 */
export type TooltipFormat = {
	readonly [channel: string]: ((value: number | BandKey) => string) | undefined;
};

/**
 * A mark's `tooltip` as an object: the default rows, reformatted or rewritten.
 *
 * @see https://sophistry.dev/guides/charts/#tooltips
 * @category Charts
 */
export interface TooltipOptions<T> {
	/** Formatters for some channels, replacing the axis's or legend's format. */
	format?: TooltipFormat;
	/** Your own content from the formatted default rows: return text, or rows (filtered, reordered, renamed or added to). */
	content?: (
		rows: readonly TooltipRow[],
		datum: T,
		index: number,
	) => TooltipContent;
}

/**
 * A mark's `tooltip` prop: `true` for its default rows (one per channel,
 * formatted as the chart's axes write them); a template such as
 * `"{series}: {y}"`; `(d, i) => string`; a {@link TooltipOptions} object;
 * or `false` for none. Omitted, the enclosing `<Chart tooltip>` decides.
 *
 * @see https://sophistry.dev/guides/charts/#tooltips
 * @category Charts
 */
export type TooltipSpec<T> =
	| boolean
	| string
	| ((datum: T, index: number) => string)
	| TooltipOptions<T>;

/**
 * Where a hover tooltip stands: by the pointer, following it, or above its datum.
 *
 * @category Charts
 */
export type TooltipAnchor = "pointer" | "datum";

/**
 * A chart's tooltip settings (`<Chart tooltip>`), as its {@link TooltipState} carries them.
 *
 * @category Extending
 */
export interface TooltipConfig {
	/** Marks without a `tooltip` of their own show their default. */
	all: boolean;
	/** Formatters for some channels; a mark's own win. */
	format?: TooltipFormat;
	/** Where a hover tooltip stands. @default "pointer" */
	anchor?: TooltipAnchor;
	/**
	 * `"x"`: one shared tooltip for every series at the x nearest the pointer,
	 * with a crosshair; marks' own tooltips are off.
	 * @default "item"
	 */
	mode?: "item" | "x";
}

/**
 * What a tooltip shows and where, in scene units.
 *
 * @category Extending
 */
export interface ActiveTooltip {
	owner: object;
	/** The content as one string: the accessible name. */
	text: string;
	content: TooltipContent;
	at: Point;
	/** Opened by a hovering pointer, so it follows it. */
	follow: boolean;
}

/**
 * One point a mark offers a chart's shared nearest-x tooltip
 * (`<Chart tooltip={{ mode: "x" }}>`).
 *
 * @category Extending
 */
export interface TooltipPoint {
	/** Where it is drawn, in scene units. */
	at: Point;
	/** Its x, as the x axis writes it: the tooltip's heading. */
	x: string;
	/** The row it adds: its series' name and its formatted y. */
	row: TooltipRow;
}

/**
 * One chart's tooltip: which datum, if any, it is showing.
 *
 * @category Extending
 */
export interface TooltipState {
	/** What is showing, if anything; the overlay binds to it. */
	active: Readable<ActiveTooltip | null>;
	/** Shows `content` about the point `at` on behalf of `owner`; with `follow`, by the pointer while it hovers. */
	show(
		owner: object,
		content: TooltipContent,
		at: Point,
		follow?: boolean,
	): void;
	/** Hides the tooltip, if `owner` is the one showing it. */
	hide(owner: object): void;
	/** The chart's settings (`chart`'s `tooltip`): undefined for none, false to turn tooltips off. */
	config(): TooltipConfig | false | undefined;
	/**
	 * Sets the points `owner` offers the shared nearest-x tooltip (a mark
	 * calls it from each update); `null` withdraws them (on dispose).
	 */
	offerPoints(owner: object, points: readonly TooltipPoint[] | null): void;
	/** Every point offered, from every mark, in the order they were first offered. */
	points(): readonly TooltipPoint[];
	/** Bumps whenever the offered points change: the overlay binds to it. */
	pointsVersion: Readable<number>;
}

/**
 * Creates a {@link TooltipState}.
 *
 * @param config - The chart's tooltip settings, read when asked.
 * @category Extending
 */
export function createTooltipState(
	config: () => TooltipConfig | false | undefined = () => undefined,
): TooltipState {
	const active = track<ActiveTooltip | null>(null);
	const pointsVersion = track(0);
	const offered = new Map<object, readonly TooltipPoint[]>();
	let all: readonly TooltipPoint[] | null = [];
	return {
		active,
		show: (owner, content, at, follow = false) =>
			active.set({ owner, text: tooltipLabel(content), content, at, follow }),
		hide: (owner) => {
			if (active.peek()?.owner === owner) active.set(null);
		},
		config,
		offerPoints(owner, points) {
			const before = offered.get(owner);
			if (points === null) {
				if (!offered.delete(owner)) return;
			} else {
				if (before === points) return;
				if (!before && points.length === 0) return;
				offered.set(owner, points);
			}
			all = null;
			pointsVersion.set(pointsVersion.peek() + 1);
		},
		points() {
			all ??= [...offered.values()].flat();
			return all;
		},
		pointsVersion,
	};
}

/**
 * The enclosing chart's tooltip state, or null outside a chart. Read it with
 * `ctx.context(tooltipContext)`.
 *
 * @category Extending
 */
export const tooltipContext: ContextKey<TooltipState | null> =
	createContextKey<TooltipState | null>("chartTooltip", null);

/**
 * One channel a mark's default tooltip reports, before formatting.
 *
 * @category Extending
 */
export interface TooltipField {
	/** The channel's prop name: `"x"`, `"y"`, `"series"`, `"size"`, … */
	channel: string;
	/** The channel prop as given; a key of the datum names the row. */
	of?: unknown;
	/** The row's name, overriding the one `of` gives. */
	name?: string;
	/** The value; null or undefined drops the row. */
	value: number | BandKey | null | undefined;
	/**
	 * How the chart writes the value (`useChart().format(…)`). Defaults to `formatTick` for
	 * numbers.
	 */
	format?: (value: number | BandKey) => string;
	/** A swatch before the row. */
	color?: string;
}

/** The text of a value with no formatter of its own. */
function plainValue(value: number | BandKey): string {
	return typeof value === "number" ? formatTick(value) : String(value);
}

/** Formats fields into rows: `formats` in order, then the field's own, then `formatTick`. */
function rowsOf(
	fields: readonly TooltipField[],
	formats: readonly (TooltipFormat | undefined)[],
): TooltipRow[] {
	const rows: TooltipRow[] = [];
	for (const field of fields) {
		const raw = field.value;
		if (raw === null || raw === undefined) continue;
		if (typeof raw === "number" && Number.isNaN(raw)) continue;
		let format: ((value: number | BandKey) => string) | undefined;
		for (const set of formats) {
			format = set?.[field.channel];
			if (format) break;
		}
		format ??= field.format ?? plainValue;
		const name =
			field.name ?? (typeof field.of === "string" ? field.of : field.channel);
		rows.push({
			channel: field.channel,
			name,
			value: format(raw),
			raw,
			...(field.color ? { color: field.color } : {}),
		});
	}
	return rows;
}

/** A `{channel}` template filled from `rows`; unknown names are left as written. */
function fillTemplate(template: string, rows: readonly TooltipRow[]): string {
	return template.replace(
		/\{(\w+)\}/g,
		(match, channel: string) =>
			rows.find((row) => row.channel === channel)?.value ?? match,
	);
}

/**
 * A tooltip's content as one string, its accessible name: text as is, rows
 * as `name: value` joined by commas.
 *
 * @category Extending
 */
export function tooltipLabel(content: TooltipContent): string {
	if (typeof content === "string") return content;
	return content
		.map((row) => (row.name ? `${row.name}: ${row.value}` : row.value))
		.join(", ");
}

/**
 * Resolves a {@link TooltipSpec} to one datum's content, or undefined for
 * none. `fallback` is the mark's default; with `state`, the chart's
 * `<Chart tooltip>` settings apply.
 */
export function tooltipText<T>(
	spec: TooltipSpec<T> | undefined,
	fallback: (datum: T, index: number) => string | readonly TooltipField[],
	datum: T,
	index: number,
	state?: TooltipState,
): TooltipContent | undefined {
	const config = state?.config();
	if (config === false || config?.mode === "x") return undefined;
	const own = spec ?? (config?.all ? true : undefined);
	if (!own) return undefined;
	if (typeof own === "function") return own(datum, index);
	const options = typeof own === "object" ? own : undefined;
	const base = fallback(datum, index);
	if (typeof base === "string" && typeof own !== "string" && !options?.content)
		return base;
	const rows =
		typeof base === "string"
			? [{ channel: "text", name: "", value: base }]
			: rowsOf(base, [options?.format, config?.format]);
	if (typeof own === "string") return fillTemplate(own, rows);
	return options?.content ? options.content(rows, datum, index) : rows;
}

/**
 * Interaction props that make a shape show its tooltip on hover, tap or
 * Enter; spread onto the shape. A mark whose `tooltip` is off registers no
 * interaction. Outside a chart, only the accessible `label` is set.
 *
 * @param tooltip - The chart's tooltip state, if any.
 * @param text - The content, or undefined for none; read reactively.
 * @param at - Where the tooltip points, in scene units.
 * @category Extending
 */
export function tooltipHandlers(
	tooltip: TooltipState | undefined,
	text: () => TooltipContent | undefined,
	at: () => Point,
): {
	readonly label?: string;
	readonly onEnter?: (event: ScenePointerEvent) => void;
	readonly onLeave?: (event: ScenePointerEvent) => void;
	readonly onTap?: (event: ScenePointerEvent) => void;
} {
	const owner = {};
	const open = (follow: boolean) => {
		const current = text();
		if (tooltip && current !== undefined)
			tooltip.show(owner, current, at(), follow);
	};
	const on = <F>(handler: F): F | undefined =>
		tooltip && text() !== undefined ? handler : undefined;
	return {
		get label() {
			const current = text();
			return current === undefined ? undefined : tooltipLabel(current);
		},
		get onEnter() {
			return on((event: ScenePointerEvent) => open(hovering(event)));
		},
		get onLeave() {
			return on(() => tooltip?.hide(owner));
		},
		get onTap() {
			return on(() => {
				if (tooltip?.active.peek()?.owner === owner) tooltip.hide(owner);
				else open(false);
			});
		},
	};
}

/** A real mouse or pen over the shape: not a synthesised keyboard event, not touch. */
function hovering(event: ScenePointerEvent | undefined): boolean {
	if (!event || !(event.pointerId >= 0)) return false;
	return event.native?.pointerType !== "touch";
}

/** Width and height of a tooltip's panel, padding included. */
interface TooltipSize {
	width: number;
	height: number;
}

/**
 * A tooltip panel's bounds: `"above"` centred over `at`, `"right"` beside it,
 * flipped when `frame`'s edge would cut it, then clamped inside `frame`.
 *
 * @internal
 */
export function placeTooltip(
	size: TooltipSize,
	at: Point,
	frame: Bounds | undefined,
	side: "above" | "right" = "above",
	gap = TIP_GAP,
): Bounds {
	let minX: number;
	let minY: number;
	if (side === "above") {
		minX = at.x - size.width / 2;
		minY = at.y + gap;
		if (frame && minY + size.height > frame.maxY)
			minY = at.y - gap - size.height;
	} else {
		minX = at.x + gap;
		minY = at.y - size.height / 2;
		if (frame && minX + size.width > frame.maxX) minX = at.x - gap - size.width;
	}
	if (frame) {
		minX = clampInto(minX, size.width, frame.minX, frame.maxX);
		minY = clampInto(minY, size.height, frame.minY, frame.maxY);
	}
	return { minX, minY, maxX: minX + size.width, maxY: minY + size.height };
}

function clampInto(
	start: number,
	length: number,
	min: number,
	max: number,
): number {
	if (length >= max - min) return min;
	return Math.min(Math.max(start, min), max - length);
}

/**
 * The points at the scene x nearest `x` (all within a hair of it, so series
 * on one grid share a tooltip). Undefined for none.
 *
 * @internal
 */
export function nearestX(
	points: readonly TooltipPoint[],
	x: number,
): { x: number; points: TooltipPoint[] } | undefined {
	return nearestXIndex(points)(x);
}

/**
 * {@link nearestX} over one set of points, for a pointer that asks on every
 * move: the points are sorted by x once and each query bisects, rather than
 * scanning and filtering them all. Answers exactly as the scan did: the
 * nearest finite point wins, a tie going to the one offered first, and the
 * group is every point within a hair of its x, in the order offered.
 *
 * @internal
 */
export function nearestXIndex(
	points: readonly TooltipPoint[],
): (x: number) => { x: number; points: TooltipPoint[] } | undefined {
	// Indices by x then by order offered: `stops` can be nearest (a finite
	// position), `column` is every point with a finite x, for the group.
	const stops: number[] = [];
	const column: number[] = [];
	points.forEach((point, i) => {
		if (!Number.isFinite(point.at.x)) return;
		column.push(i);
		if (Number.isFinite(point.at.y)) stops.push(i);
	});
	const byX = (a: number, b: number) =>
		points[a].at.x - points[b].at.x || a - b;
	stops.sort(byX);
	column.sort(byX);
	const stopXs = stops.map((i) => points[i].at.x);
	const columnXs = column.map((i) => points[i].at.x);

	return (x) => {
		if (stops.length === 0) return undefined;
		let first = stops.length;
		if (Number.isFinite(x)) {
			// The nearest x is on one side of `x` or the other; every stop at
			// that same distance (equal xs, or a rounding tie) is a candidate,
			// and the earliest offered wins, as the scan's strict `<` had it.
			const above = lowerBound(stopXs, x);
			const distance = Math.min(
				above < stopXs.length ? stopXs[above] - x : Number.POSITIVE_INFINITY,
				above > 0 ? x - stopXs[above - 1] : Number.POSITIVE_INFINITY,
			);
			for (let k = above - 1; k >= 0 && x - stopXs[k] === distance; k--)
				first = Math.min(first, stops[k]);
			for (let k = above; k < stopXs.length && stopXs[k] - x === distance; k++)
				first = Math.min(first, stops[k]);
		} else {
			// Every distance is NaN or infinite: the scan kept its first stop.
			for (const i of stops) first = Math.min(first, i);
		}
		const at = points[first].at.x;
		const group: number[] = [];
		const middle = lowerBound(columnXs, at);
		for (let k = middle - 1; k >= 0 && Math.abs(columnXs[k] - at) < 1e-6; k--)
			group.push(column[k]);
		for (
			let k = middle;
			k < columnXs.length && Math.abs(columnXs[k] - at) < 1e-6;
			k++
		)
			group.push(column[k]);
		group.sort((a, b) => a - b);
		return { x: at, points: group.map((i) => points[i]) };
	};
}

/**
 * One datum's channel value: a key, or `(d, i) => value`; undefined for an
 * omitted or constant channel.
 *
 * @internal
 */
export function datumValue<T>(
	of: unknown,
	datum: T,
	index: number,
): number | BandKey | undefined {
	if (typeof of === "function")
		return (of as (d: T, i: number) => number | BandKey | undefined)(
			datum,
			index,
		);
	if (typeof of === "string" && datum !== null && typeof datum === "object")
		return (datum as Record<string, unknown>)[of] as number | BandKey;
	return undefined;
}

/** One datum a mark offers the shared nearest-x tooltip, before formatting. @internal */
export interface SharedTooltipDatum {
	/** Data units. */
	x: number;
	y: number;
	/** Where it is drawn, in scene units. */
	at: Point;
	/** Its series, naming its row; omitted, the row is named by the `y` channel. */
	series?: BandKey;
	color?: string;
}

/**
 * The points a mark offers the shared nearest-x tooltip: one row each, named
 * by series (else the `y` channel). Empty unless the chart's tooltip mode is
 * `"x"`, so `data` is only read while it is on. Pass the result to
 * `tooltip.offerPoints(owner, points)`.
 *
 * @internal
 */
export function sharedTooltipPoints(
	tooltip: TooltipState | null | undefined,
	data: () => readonly SharedTooltipDatum[],
	channels: {
		y: unknown;
		format?: (
			channel: "x" | "y" | "series",
		) => (value: number | BandKey) => string;
	},
): readonly TooltipPoint[] {
	if (!tooltip) return [];
	const config = tooltip.config();
	if (config === false || config?.mode !== "x") return [];
	const formatOf = (channel: "x" | "y" | "series") =>
		config.format?.[channel] ?? channels.format?.(channel) ?? plainValue;
	const x = formatOf("x");
	const y = formatOf("y");
	const series = formatOf("series");
	const yName = typeof channels.y === "string" ? channels.y : "y";
	return data().map((datum) => ({
		at: datum.at,
		x: x(datum.x),
		row: {
			channel: datum.series === undefined ? "y" : "series",
			name: datum.series === undefined ? yName : series(datum.series),
			value: y(datum.y),
			raw: datum.y,
			...(datum.color ? { color: datum.color } : {}),
		},
	}));
}
