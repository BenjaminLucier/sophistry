/**
 * Grid layout, following the CSS Grid Layout algorithm: the explicit grid
 * (with repeats resolved), placing items on lines (§8), sizing the tracks
 * of each axis (§12) and aligning items within their areas.
 *
 * The columns are sized first, from the items' widths; the rows then use the
 * widths the items take in their column areas. An automatic width is
 * fit-content, as in a flex container; an automatic height is the height of
 * the rows.
 */

import {
	distribute,
	fitContent,
	layoutAbsolute,
	relativeOffset,
} from "./flexbox.js";
import type {
	AvailableSpace,
	ComputeNode,
	Entry,
	MaybeSize,
	SizingInputs,
} from "./node.js";
import {
	autoEdges,
	clamp,
	hideSubtree,
	maybeClamp,
	resolveEdges,
	shrinkSpace,
} from "./node.js";
import type {
	AlignItems,
	Edges,
	JustifyContent,
	ParsedBreadth,
	ParsedPlacement,
	ParsedTemplate,
	ParsedTrack,
	Size,
} from "./style.js";
import { resolve } from "./style.js";

/** Tolerance for comparing accumulated lengths. */
const EPSILON = 1e-6;

type Axis = "width" | "height";
type Flow = "row" | "column";

const FLOW_OF: Record<Axis, Flow> = { width: "column", height: "row" };

/** Where an item sits on one axis: a first track and a number of tracks. */
interface Slot {
	/** `undefined` until the item is placed (or when it names no line). */
	start: number | undefined;
	span: number;
}

/** How an item sits within its area on one axis. */
type SelfAlign = "start" | "end" | "center" | "stretch";

interface GridItem {
	entry: Entry;
	slots: Record<Flow, Slot>;
	justify: SelfAlign;
	align: SelfAlign;
	/** Margins against the width of the item's area; zero until its column is known. */
	margin: Edges<number>;
	autoMargin: Edges<boolean>;
	areaWidth: number;
	/** The border-box width, once the columns are sized. */
	width: number;
}

/** The tracks of one axis of the implicit grid. */
interface AxisTracks {
	defs: ParsedTrack[];
	/** Tracks of an `auto-fit` repeat that no item occupies. */
	collapsed: boolean[];
}

interface Grid {
	items: GridItem[];
	columns: AxisTracks;
	rows: AxisTracks;
}

/* ------------------------------------------------------------ track sizing */

type MinFunction =
	| { kind: "fixed"; value: number }
	| { kind: "auto" | "min-content" | "max-content" };

type MaxFunction =
	| { kind: "fixed"; value: number }
	| { kind: "auto" | "min-content" | "max-content" }
	| { kind: "fit-content"; limit: number }
	| { kind: "flex"; factor: number };

interface Track {
	min: MinFunction;
	max: MaxFunction;
	base: number;
	limit: number;
}

/** An item as the track sizing algorithm sees it: the tracks it spans and its outer contributions. */
interface SpanItem {
	start: number;
	end: number;
	/** `contentBased`: the automatic minimum size applies. */
	minimum(contentBased: boolean): number;
	minContent(): number;
	maxContent(): number;
}

const isIntrinsicMin = (track: Track) => track.min.kind !== "fixed";
const isContentMin = (track: Track) =>
	track.min.kind === "min-content" || track.min.kind === "max-content";
const isMaxContentMin = (track: Track) => track.min.kind === "max-content";
const isIntrinsicMax = (track: Track) =>
	track.max.kind === "min-content" ||
	track.max.kind === "max-content" ||
	track.max.kind === "auto" ||
	track.max.kind === "fit-content";
const isMaxContentMax = (track: Track) =>
	track.max.kind === "max-content" ||
	track.max.kind === "auto" ||
	track.max.kind === "fit-content";
const isFlexible = (track: Track) => track.max.kind === "flex";

/** Turns a parsed track into the form sizing works on; percentages need a definite `basis`. */
function prepareTrack(def: ParsedTrack, basis: number | undefined): Track {
	const fixed = (breadth: ParsedBreadth): number | undefined => {
		if (breadth.kind === "length") return breadth.value;
		if (breadth.kind === "percent" && basis !== undefined) {
			return breadth.value * basis;
		}
		return undefined;
	};
	const minLength = fixed(def.min);
	const min: MinFunction =
		minLength !== undefined
			? { kind: "fixed", value: minLength }
			: def.min.kind === "min-content" || def.min.kind === "max-content"
				? { kind: def.min.kind }
				: { kind: "auto" };
	const maxLength = fixed(def.max);
	let max: MaxFunction;
	if (maxLength !== undefined) {
		max = { kind: "fixed", value: maxLength };
	} else if (def.max.kind === "fr") {
		max = { kind: "flex", factor: def.max.value };
	} else if (def.max.kind === "fit-content") {
		const limit = resolve(def.max.limit, basis);
		max = { kind: "fit-content", limit: limit ?? Number.POSITIVE_INFINITY };
	} else if (def.max.kind === "min-content" || def.max.kind === "max-content") {
		max = { kind: def.max.kind };
	} else {
		max = { kind: "auto" };
	}
	return { min, max, base: 0, limit: 0 };
}

function sum(values: Iterable<number>): number {
	let total = 0;
	for (const value of values) total += value;
	return total;
}

/**
 * Distributes the extra space items need over the tracks they span (§12.5.1).
 * Every item is measured against the sizes as they stood before this call,
 * and each track takes the largest increase any item asks of it.
 */
function distributeSpace(
	tracks: Track[],
	gutters: number[],
	group: SpanItem[],
	grows: "base" | "limit",
	affected: (track: Track) => boolean,
	beyondLimits: (track: Track) => boolean,
	contribution: (item: SpanItem) => number,
): void {
	const planned = tracks.map(() => 0);
	const sizeOf = (track: Track) =>
		grows === "base" || track.limit === Number.POSITIVE_INFINITY
			? track.base
			: track.limit;
	const capOf = (track: Track) =>
		grows === "base"
			? track.limit
			: track.max.kind === "fit-content"
				? track.max.limit
				: Number.POSITIVE_INFINITY;
	for (const item of group) {
		const indices: number[] = [];
		let spanned = 0;
		for (let i = item.start; i < item.end; i++) {
			const track = tracks[i] as Track;
			spanned += sizeOf(track);
			if (i > item.start) spanned += gutters[i - 1] as number;
			if (affected(track)) indices.push(i);
		}
		if (indices.length === 0) continue;
		let remaining = contribution(item) - spanned;
		if (remaining <= EPSILON) continue;
		const increase = new Map<number, number>(indices.map((i) => [i, 0]));
		// Up to the limits, equally.
		let active = indices;
		while (remaining > EPSILON && active.length > 0) {
			const share = remaining / active.length;
			const next: number[] = [];
			let used = 0;
			for (const i of active) {
				const track = tracks[i] as Track;
				const room = capOf(track) - sizeOf(track) - (increase.get(i) as number);
				const take = Math.min(share, Math.max(0, room));
				increase.set(i, (increase.get(i) as number) + take);
				used += take;
				if (take >= share - EPSILON) next.push(i);
			}
			remaining -= used;
			active = next;
		}
		// Beyond them, to the tracks the contribution is meant for.
		if (remaining > EPSILON) {
			let targets = indices.filter((i) => beyondLimits(tracks[i] as Track));
			if (targets.length === 0) targets = indices;
			for (const i of targets) {
				increase.set(
					i,
					(increase.get(i) as number) + remaining / targets.length,
				);
			}
		}
		for (const [i, value] of increase) {
			planned[i] = Math.max(planned[i] as number, value);
		}
	}
	tracks.forEach((track, i) => {
		const extra = planned[i] as number;
		if (extra <= 0) return;
		if (grows === "base") track.base += extra;
		else track.limit = sizeOf(track) + extra;
	});
}

/** The size of one fraction when `space` is to be filled by tracks `start` up to `end` (§12.7.1). */
function findFractionSize(
	tracks: Track[],
	gutters: number[],
	start: number,
	end: number,
	space: number,
): number {
	let leftover = space;
	let flexible: number[] = [];
	for (let i = start; i < end; i++) {
		if (i > start) leftover -= gutters[i - 1] as number;
		const track = tracks[i] as Track;
		if (isFlexible(track)) flexible.push(i);
		else leftover -= track.base;
	}
	const factorOf = (i: number) =>
		((tracks[i] as Track).max as { factor: number }).factor;
	for (;;) {
		if (flexible.length === 0) return 0;
		const total = Math.max(1, sum(flexible.map(factorOf)));
		const size = Math.max(0, leftover) / total;
		const inflexible = flexible.filter(
			(i) => size * factorOf(i) < (tracks[i] as Track).base - EPSILON,
		);
		if (inflexible.length === 0) return size;
		for (const i of inflexible) leftover -= (tracks[i] as Track).base;
		flexible = flexible.filter((i) => !inflexible.includes(i));
	}
}

/**
 * Sizes tracks in place (§12): initial sizes, intrinsic sizes from the
 * items, growing to fill a definite space, fractions, then stretching `auto`
 * tracks. `space` is the length to fill, or `"min-content"` / `"max-content"`
 * when the container's own intrinsic size is being found. On return each
 * track's `base` is its size.
 */
function sizeTracks(
	tracks: Track[],
	gutters: number[],
	items: SpanItem[],
	space: number | "min-content" | "max-content",
	stretchAuto: boolean,
): void {
	const infinity = Number.POSITIVE_INFINITY;
	const gutterTotal = sum(gutters);
	for (const track of tracks) {
		track.base = track.min.kind === "fixed" ? track.min.value : 0;
		track.limit = track.max.kind === "fixed" ? track.max.value : infinity;
		if (track.limit < track.base) track.limit = track.base;
	}
	const raiseLimits = () => {
		for (const track of tracks) {
			if (track.limit < track.base) track.limit = track.base;
		}
	};
	const contentBased = (item: SpanItem): boolean => {
		let autoMin = false;
		let flexible = false;
		for (let i = item.start; i < item.end; i++) {
			const track = tracks[i] as Track;
			if (track.min.kind === "auto") autoMin = true;
			if (isFlexible(track)) flexible = true;
		}
		return autoMin && !(item.end - item.start > 1 && flexible);
	};

	// Items that span a single track.
	const rawLimit = tracks.map(() => -1);
	for (const item of items) {
		if (item.end - item.start !== 1) continue;
		const index = item.start;
		const track = tracks[index] as Track;
		if (track.min.kind === "auto") {
			track.base = Math.max(track.base, item.minimum(contentBased(item)));
		} else if (track.min.kind === "min-content") {
			track.base = Math.max(track.base, item.minContent());
		} else if (track.min.kind === "max-content") {
			track.base = Math.max(track.base, item.maxContent());
		}
		if (track.max.kind === "min-content") {
			rawLimit[index] = Math.max(rawLimit[index] as number, item.minContent());
		} else if (isMaxContentMax(track)) {
			rawLimit[index] = Math.max(rawLimit[index] as number, item.maxContent());
		}
	}
	tracks.forEach((track, i) => {
		const raw = rawLimit[i] as number;
		if (raw < 0) return;
		track.limit =
			track.max.kind === "fit-content" ? Math.min(raw, track.max.limit) : raw;
	});
	raiseLimits();

	// Items that span several tracks, none flexible, by increasing span.
	const spanning = items.filter((item) => item.end - item.start > 1);
	const plain = spanning.filter(
		(item) =>
			!tracks.slice(item.start, item.end).some((track) => isFlexible(track)),
	);
	const spans = [...new Set(plain.map((item) => item.end - item.start))].sort(
		(a, b) => a - b,
	);
	for (const span of spans) {
		const group = plain.filter((item) => item.end - item.start === span);
		distributeSpace(
			tracks,
			gutters,
			group,
			"base",
			isIntrinsicMin,
			isIntrinsicMax,
			(item) => item.minimum(contentBased(item)),
		);
		distributeSpace(
			tracks,
			gutters,
			group,
			"base",
			isContentMin,
			isIntrinsicMax,
			(item) => item.minContent(),
		);
		distributeSpace(
			tracks,
			gutters,
			group,
			"base",
			isMaxContentMin,
			isMaxContentMax,
			(item) => item.maxContent(),
		);
		raiseLimits();
		distributeSpace(
			tracks,
			gutters,
			group,
			"limit",
			isIntrinsicMax,
			() => true,
			(item) => item.minContent(),
		);
		distributeSpace(
			tracks,
			gutters,
			group,
			"limit",
			isMaxContentMax,
			() => true,
			(item) => item.maxContent(),
		);
	}
	// Items that span a flexible track, together, growing only flexible tracks.
	const flexing = spanning.filter((item) =>
		tracks.slice(item.start, item.end).some((track) => isFlexible(track)),
	);
	distributeSpace(
		tracks,
		gutters,
		flexing,
		"base",
		(track) => isFlexible(track) && isIntrinsicMin(track),
		() => true,
		(item) => item.minimum(contentBased(item)),
	);
	for (const track of tracks) {
		if (track.limit === infinity || track.limit < track.base) {
			track.limit = track.base;
		}
	}

	// Maximize: grow up to the growth limits.
	if (space === "max-content") {
		for (const track of tracks) track.base = track.limit;
	} else if (typeof space === "number") {
		let free = space - sum(tracks.map((track) => track.base)) - gutterTotal;
		let active = tracks.filter((track) => track.base < track.limit);
		while (free > EPSILON && active.length > 0) {
			const share = free / active.length;
			const next: Track[] = [];
			for (const track of active) {
				const take = Math.min(share, track.limit - track.base);
				track.base += take;
				free -= take;
				if (take >= share - EPSILON) next.push(track);
			}
			active = next;
		}
	}

	// Expand the fractions.
	const flexible = tracks.filter(isFlexible);
	if (flexible.length > 0) {
		let fraction: number;
		if (typeof space === "number") {
			fraction = findFractionSize(tracks, gutters, 0, tracks.length, space);
		} else {
			fraction = 0;
			for (const track of flexible) {
				const factor = (track.max as { factor: number }).factor;
				fraction = Math.max(
					fraction,
					factor > 1 ? track.base / factor : track.base,
				);
			}
			for (const item of items) {
				if (
					!tracks.slice(item.start, item.end).some((track) => isFlexible(track))
				) {
					continue;
				}
				fraction = Math.max(
					fraction,
					findFractionSize(
						tracks,
						gutters,
						item.start,
						item.end,
						item.maxContent(),
					),
				);
			}
		}
		for (const track of flexible) {
			const size = fraction * (track.max as { factor: number }).factor;
			if (size > track.base) track.base = size;
		}
	}

	// Stretch the `auto` tracks over what is left.
	if (stretchAuto && typeof space === "number") {
		const free = space - sum(tracks.map((track) => track.base)) - gutterTotal;
		const autos = tracks.filter((track) => track.max.kind === "auto");
		if (free > EPSILON && autos.length > 0) {
			for (const track of autos) track.base += free / autos.length;
		}
	}
}

/* --------------------------------------------------------------- placement */

/** A placement's line indices in the explicit grid, or just a span when it names none. */
function resolvePlacement(
	placement: ParsedPlacement,
	explicitCount: number,
): Slot {
	const index = (line: number) =>
		line > 0 ? line - 1 : explicitCount + line + 1;
	const { start, end, span } = placement;
	if (start !== undefined && end !== undefined) {
		const a = index(start);
		const b = index(end);
		return { start: Math.min(a, b), span: Math.max(1, Math.abs(b - a)) };
	}
	if (start !== undefined) return { start: index(start), span: span ?? 1 };
	if (end !== undefined) {
		const span1 = span ?? 1;
		return { start: index(end) - span1, span: span1 };
	}
	return { start: undefined, span: span ?? 1 };
}

/** The explicit tracks of one axis, with `auto-fill` and `auto-fit` repeats resolved. */
function expandTemplate(
	template: ParsedTemplate,
	extent: { definite?: number; min?: number; max?: number },
	gap: number,
): { tracks: ParsedTrack[]; autoFit: boolean[] } {
	const trackLength = (def: ParsedTrack): number => {
		const length = (breadth: ParsedBreadth) =>
			breadth.kind === "length"
				? breadth.value
				: breadth.kind === "percent" && extent.definite !== undefined
					? breadth.value * extent.definite
					: undefined;
		const max = length(def.max);
		const min = length(def.min);
		return max !== undefined ? Math.max(max, min ?? 0) : (min ?? 0);
	};
	let repetitions = 1;
	const auto = template.find(
		(entry) =>
			entry.kind === "repeat" &&
			(entry.count === "auto-fill" || entry.count === "auto-fit"),
	);
	if (auto && auto.kind === "repeat") {
		let fixedCount = 0;
		let fixedSum = 0;
		for (const entry of template) {
			if (entry === auto) continue;
			const tracks = entry.kind === "track" ? [entry.track] : entry.tracks;
			const times = entry.kind === "repeat" ? (entry.count as number) : 1;
			fixedCount += tracks.length * times;
			fixedSum += sum(tracks.map(trackLength)) * times;
		}
		const perRepeat = sum(auto.tracks.map(trackLength));
		const denominator = perRepeat + auto.tracks.length * gap;
		const fit = (size: number) =>
			(size - fixedSum - (fixedCount - 1) * gap) / denominator;
		if (denominator > 0) {
			if (extent.definite !== undefined) {
				repetitions = Math.floor(fit(extent.definite) + EPSILON);
			} else if (extent.max !== undefined) {
				repetitions = Math.floor(fit(extent.max) + EPSILON);
			} else if (extent.min !== undefined) {
				repetitions = Math.ceil(fit(extent.min) - EPSILON);
			}
			repetitions = Math.max(1, repetitions);
		}
	}
	const tracks: ParsedTrack[] = [];
	const autoFit: boolean[] = [];
	for (const entry of template) {
		if (entry.kind === "track") {
			tracks.push(entry.track);
			autoFit.push(false);
			continue;
		}
		const times = typeof entry.count === "number" ? entry.count : repetitions;
		for (let n = 0; n < times; n++) {
			for (const track of entry.tracks) {
				tracks.push(track);
				autoFit.push(entry.count === "auto-fit");
			}
		}
	}
	return { tracks, autoFit };
}

interface Placement {
	rows: number;
	columns: number;
	rowOffset: number;
	columnOffset: number;
}

/**
 * Places every item on lines of the implicit grid (§8.5): items with both
 * positions first, then those locked to a line of the flow's major axis, then
 * the rest in order with a cursor, sparse or dense. Writes each item's slots
 * and returns the grid's size and where its explicit grid starts.
 */
function placeItems(
	items: GridItem[],
	explicit: Record<Flow, number>,
	autoFlow: string,
): Placement {
	const dense = autoFlow.endsWith("dense");
	const major: Flow = autoFlow.startsWith("column") ? "column" : "row";
	const minor: Flow = major === "row" ? "column" : "row";

	const offset: Record<Flow, number> = { row: 0, column: 0 };
	for (const flow of ["row", "column"] as const) {
		for (const item of items) {
			const start = item.slots[flow].start;
			if (start !== undefined) offset[flow] = Math.max(offset[flow], -start);
		}
		for (const item of items) {
			const slot = item.slots[flow];
			if (slot.start !== undefined) slot.start += offset[flow];
		}
	}
	const count: Record<Flow, number> = {
		row: offset.row + explicit.row,
		column: offset.column + explicit.column,
	};
	const occupied = new Set<string>();
	const cell = (row: number, column: number) => `${row},${column}`;
	const overlaps = (item: GridItem, at: Record<Flow, number>): boolean => {
		for (let r = 0; r < item.slots.row.span; r++) {
			for (let c = 0; c < item.slots.column.span; c++) {
				if (occupied.has(cell(at.row + r, at.column + c))) return true;
			}
		}
		return false;
	};
	const place = (item: GridItem, at: Record<Flow, number>) => {
		item.slots.row.start = at.row;
		item.slots.column.start = at.column;
		for (let r = 0; r < item.slots.row.span; r++) {
			for (let c = 0; c < item.slots.column.span; c++) {
				occupied.add(cell(at.row + r, at.column + c));
			}
		}
		for (const flow of ["row", "column"] as const) {
			count[flow] = Math.max(count[flow], at[flow] + item.slots[flow].span);
		}
	};
	const startOf = (item: GridItem, flow: Flow) =>
		item.slots[flow].start as number;

	// 1. Items that name both positions.
	for (const item of items) {
		if (
			item.slots.row.start !== undefined &&
			item.slots.column.start !== undefined
		) {
			place(item, {
				row: startOf(item, "row"),
				column: startOf(item, "column"),
			});
		}
	}

	// 2. Items locked to a line of the major axis.
	const cursorWithin = new Map<number, number>();
	for (const item of items) {
		if (item.slots[major].start === undefined) continue;
		if (item.slots[minor].start !== undefined) continue;
		const line = startOf(item, major);
		let position = dense ? 0 : (cursorWithin.get(line) ?? 0);
		const at = { row: 0, column: 0 };
		at[major] = line;
		for (;;) {
			at[minor] = position;
			if (!overlaps(item, at)) break;
			position++;
		}
		place(item, at);
		cursorWithin.set(line, position + item.slots[minor].span);
	}

	// 3. The size of the implicit grid along the minor axis.
	for (const item of items) {
		const slot = item.slots[minor];
		count[minor] = Math.max(
			count[minor],
			slot.start === undefined ? slot.span : slot.start + slot.span,
		);
	}

	// 4. Everything else, with the cursor.
	let cursorMajor = 0;
	let cursorMinor = 0;
	for (const item of items) {
		if (
			item.slots.row.start !== undefined &&
			item.slots.column.start !== undefined
		) {
			continue;
		}
		const at = { row: 0, column: 0 };
		const span = item.slots[minor].span;
		if (item.slots[minor].start !== undefined) {
			const wanted = startOf(item, minor);
			if (dense) {
				cursorMajor = 0;
			} else if (wanted < cursorMinor) {
				cursorMajor++;
			}
			cursorMinor = wanted;
			at[minor] = wanted;
			for (;;) {
				at[major] = cursorMajor;
				if (!overlaps(item, at)) break;
				cursorMajor++;
			}
		} else {
			if (dense) {
				cursorMajor = 0;
				cursorMinor = 0;
			}
			for (;;) {
				at[major] = cursorMajor;
				at[minor] = cursorMinor;
				if (cursorMinor + span <= count[minor] && !overlaps(item, at)) break;
				cursorMinor++;
				if (cursorMinor + span > count[minor]) {
					cursorMinor = 0;
					cursorMajor++;
				}
			}
		}
		place(item, at);
	}
	return {
		rows: count.row,
		columns: count.column,
		rowOffset: offset.row,
		columnOffset: offset.column,
	};
}

/** The tracks of the implicit grid for one axis, from the explicit ones and the auto sizes. */
function implicitTracks(
	explicit: { tracks: ParsedTrack[]; autoFit: boolean[] },
	auto: ParsedTrack[],
	count: number,
	offset: number,
	items: GridItem[],
	flow: Flow,
): AxisTracks {
	const defs: ParsedTrack[] = [];
	const collapsed: boolean[] = [];
	for (let i = 0; i < count; i++) {
		const index = i - offset;
		if (index >= 0 && index < explicit.tracks.length) {
			defs.push(explicit.tracks[index] as ParsedTrack);
			collapsed.push(
				(explicit.autoFit[index] as boolean) &&
					!items.some((item) => {
						const slot = item.slots[flow];
						const start = slot.start as number;
						return i >= start && i < start + slot.span;
					}),
			);
		} else {
			const position =
				index < 0
					? ((index % auto.length) + auto.length) % auto.length
					: (index - explicit.tracks.length) % auto.length;
			defs.push(auto[position] as ParsedTrack);
			collapsed.push(false);
		}
	}
	return { defs, collapsed };
}

/* --------------------------------------------------------------- the layout */

const alignOf = (
	value: AlignItems | "start" | "end" | "center" | "stretch",
) => {
	switch (value) {
		case "flex-start":
		case "start":
			return "start";
		case "flex-end":
		case "end":
			return "end";
		default:
			return value;
	}
};

/** Distance from a track's start to the next track's start, for each track. */
function trackPositions(
	sizes: number[],
	gutters: number[],
	free: number,
	mode: JustifyContent | "stretch",
): number[] {
	const [start, between] = distribute(
		mode === "stretch" ? "flex-start" : mode,
		free,
		sizes.length,
	);
	const positions: number[] = [];
	let offset = start;
	sizes.forEach((size, i) => {
		positions.push(offset);
		offset += size + ((gutters[i] as number | undefined) ?? 0) + between;
	});
	return positions;
}

/**
 * Sizes a grid container and, with `inputs.perform`, lays out its children.
 *
 * @param entry - The container.
 * @param inputs - Known size, containing block, available space, mode.
 * @param compute - Sizes (or lays out) a child.
 * @returns The container's border-box size.
 */
export function layoutGrid(
	entry: Entry,
	inputs: SizingInputs,
	compute: ComputeNode,
): Size {
	const style = entry.style;
	const { known, parentSize, available, perform } = inputs;

	/* ------------------------------------------------- the container's box */

	const own = (
		value: Parameters<typeof resolve>[0],
		basis: number | undefined,
		axis: Axis,
	) => (inputs.contentAxis === axis ? undefined : resolve(value, basis));
	const padding = resolveEdges(style.padding, parentSize.width);
	const border = resolveEdges(style.border, parentSize.width);
	const inset: Size = {
		width: padding.left + padding.right + border.left + border.right,
		height: padding.top + padding.bottom + border.top + border.bottom,
	};
	const min: MaybeSize = {
		width: own(style.minSize.width, parentSize.width, "width"),
		height: own(style.minSize.height, parentSize.height, "height"),
	};
	const max: MaybeSize = {
		width: own(style.maxSize.width, parentSize.width, "width"),
		height: own(style.maxSize.height, parentSize.height, "height"),
	};
	const styled: MaybeSize = {
		width:
			known.width ??
			maybeClamp(
				own(style.size.width, parentSize.width, "width"),
				min.width,
				max.width,
			),
		height:
			known.height ??
			maybeClamp(
				own(style.size.height, parentSize.height, "height"),
				min.height,
				max.height,
			),
	};
	const outerWidth =
		styled.width === undefined
			? undefined
			: Math.max(styled.width, inset.width);
	const outerHeight =
		styled.height === undefined
			? undefined
			: Math.max(styled.height, inset.height);
	if (!perform && outerWidth !== undefined && outerHeight !== undefined) {
		return { width: outerWidth, height: outerHeight };
	}
	const innerOf = (value: number | undefined, extra: number) =>
		value === undefined ? undefined : Math.max(0, value - extra);
	const innerMin: MaybeSize = {
		width: innerOf(min.width, inset.width),
		height: innerOf(min.height, inset.height),
	};
	const innerMax: MaybeSize = {
		width: innerOf(max.width, inset.width),
		height: innerOf(max.height, inset.height),
	};
	const inner: MaybeSize = {
		width: outerWidth === undefined ? undefined : outerWidth - inset.width,
		height: outerHeight === undefined ? undefined : outerHeight - inset.height,
	};
	const availableInner: Size<AvailableSpace> = {
		width:
			inner.width ??
			shrinkSpace(
				typeof available.width === "number" && max.width !== undefined
					? Math.min(available.width, max.width)
					: available.width,
				inset.width,
			),
		height: inner.height ?? "max-content",
	};

	const flow: Entry[] = [];
	const absolute: Entry[] = [];
	for (const child of entry.children) {
		if (child.style.display === "none") {
			if (perform) hideSubtree(child);
		} else if (child.style.position === "absolute") {
			absolute.push(child);
		} else {
			flow.push(child);
		}
	}

	const gapOf = (axis: Axis) => resolve(style.gap[axis], inner[axis]) ?? 0;

	/* -------------------------------------------------- the grid and its items */

	const buildGrid = (): Grid => {
		const columnsTemplate = expandTemplate(
			style.gridTemplateColumns,
			{
				definite: inner.width,
				min: innerMin.width,
				max: innerMax.width,
			},
			gapOf("width"),
		);
		const rowsTemplate = expandTemplate(
			style.gridTemplateRows,
			{
				definite: inner.height,
				min: innerMin.height,
				max: innerMax.height,
			},
			gapOf("height"),
		);
		const items: GridItem[] = flow.map((child) => {
			const cs = child.style;
			return {
				entry: child,
				slots: {
					column: resolvePlacement(
						cs.gridColumn,
						columnsTemplate.tracks.length,
					),
					row: resolvePlacement(cs.gridRow, rowsTemplate.tracks.length),
				},
				justify: alignOf(
					cs.justifySelf === "auto" ? style.justifyItems : cs.justifySelf,
				),
				align: alignOf(
					cs.alignSelf === "auto" ? style.alignItems : cs.alignSelf,
				),
				// Percentages wait for the column area; until then they count as zero.
				margin: resolveEdges(cs.margin, undefined),
				autoMargin: autoEdges(cs.margin),
				areaWidth: 0,
				width: 0,
			};
		});
		const placement = placeItems(
			items,
			{
				row: rowsTemplate.tracks.length,
				column: columnsTemplate.tracks.length,
			},
			style.gridAutoFlow,
		);
		return {
			items,
			columns: implicitTracks(
				columnsTemplate,
				style.gridAutoColumns,
				placement.columns,
				placement.columnOffset,
				items,
				"column",
			),
			rows: implicitTracks(
				rowsTemplate,
				style.gridAutoRows,
				placement.rows,
				placement.rowOffset,
				items,
				"row",
			),
		};
	};
	const hasAutoRepeat = (axis: Axis) =>
		(axis === "width"
			? style.gridTemplateColumns
			: style.gridTemplateRows
		).some(
			(item) =>
				item.kind === "repeat" &&
				(item.count === "auto-fill" || item.count === "auto-fit"),
		);
	let grid = buildGrid();

	/** Collapsed `auto-fit` tracks take no gutter. */
	const guttersOf = (tracks: AxisTracks, gap: number): number[] => {
		const count = tracks.defs.length;
		const gutters: number[] = [];
		for (let i = 0; i + 1 < count; i++) {
			let trailing = tracks.collapsed[i + 1] as boolean;
			for (let j = i + 2; trailing && j < count; j++) {
				trailing = tracks.collapsed[j] as boolean;
			}
			gutters.push(tracks.collapsed[i] || trailing ? 0 : gap);
		}
		return gutters;
	};

	const insetOf = (child: Entry, axis: Axis, basis: number | undefined) => {
		const childPadding = resolveEdges(child.style.padding, basis);
		const childBorder = resolveEdges(child.style.border, basis);
		return axis === "width"
			? childPadding.left +
					childPadding.right +
					childBorder.left +
					childBorder.right
			: childPadding.top +
					childPadding.bottom +
					childBorder.top +
					childBorder.bottom;
	};
	const marginSum = (item: GridItem, axis: Axis) =>
		axis === "width"
			? item.margin.left + item.margin.right
			: item.margin.top + item.margin.bottom;

	/** The items as the sizing algorithm sees them along one axis. */
	const spanItems = (axis: Axis): SpanItem[] =>
		grid.items.map((item) => {
			const child = item.entry;
			const cs = child.style;
			const slot = item.slots[FLOW_OF[axis]];
			const start = slot.start as number;
			// Columns come first, so the rows know the item's width.
			const columns = axis === "width";
			const known: MaybeSize = {
				width: columns ? undefined : item.width,
				height: undefined,
			};
			const basis: MaybeSize = {
				width: columns ? undefined : item.areaWidth,
				height: undefined,
			};
			const outer = marginSum(item, axis);
			const measure = (
				mode: "min-content" | "max-content",
				ignoreOwn: boolean,
			) =>
				compute(child, {
					known,
					parentSize: basis,
					available: {
						width: columns ? mode : item.width,
						height: columns ? "max-content" : mode,
					},
					perform: false,
					contentAxis: ignoreOwn ? axis : undefined,
				})[axis];
			const floor = insetOf(child, axis, basis.width);
			const cache = new Map<string, number>();
			const memo = (key: string, make: () => number) => {
				let value = cache.get(key);
				if (value === undefined) {
					value = make();
					cache.set(key, value);
				}
				return value;
			};
			return {
				start,
				end: start + slot.span,
				minContent: () =>
					memo(
						"min",
						() => Math.max(measure("min-content", false), floor) + outer,
					),
				maxContent: () =>
					memo(
						"max",
						() => Math.max(measure("max-content", false), floor) + outer,
					),
				minimum: (contentBased) =>
					memo(`minimum${contentBased}`, () => {
						const explicit = resolve(cs.minSize[axis], undefined);
						const largest = resolve(cs.maxSize[axis], undefined);
						let size: number;
						if (explicit !== undefined) {
							size = explicit;
						} else if (contentBased) {
							// A definite size is its own min-content contribution, even
							// for an item that could shrink below its content.
							const specified = resolve(cs.size[axis], undefined);
							size =
								specified ??
								(cs.overflow === "hidden" ? 0 : measure("min-content", true));
							if (largest !== undefined) size = Math.min(size, largest);
						} else {
							size = 0;
						}
						return Math.max(size, floor) + outer;
					}),
			};
		});

	const stretchColumns = style.justifyContent === undefined;
	const stretchRows = style.alignContent === "stretch";

	/** Sizes one axis' tracks against `space`; returns the sizes and gutters. */
	const sizeAxis = (
		axis: Axis,
		space: number | "min-content" | "max-content",
	) => {
		const tracks = axis === "width" ? grid.columns : grid.rows;
		const gutters = guttersOf(tracks, gapOf(axis));
		const sized: Track[] = tracks.defs.map((def, i) =>
			tracks.collapsed[i]
				? {
						min: { kind: "fixed", value: 0 },
						max: { kind: "fixed", value: 0 },
						base: 0,
						limit: 0,
					}
				: prepareTrack(def, typeof space === "number" ? space : undefined),
		);
		sizeTracks(
			sized,
			gutters,
			spanItems(axis),
			space,
			axis === "width" ? stretchColumns : stretchRows,
		);
		return { sizes: sized.map((track) => track.base), gutters };
	};
	const total = (sized: { sizes: number[]; gutters: number[] }) =>
		sum(sized.sizes) + sum(sized.gutters);

	/* -------------------------------------------------------------- columns */

	if (inner.width === undefined) {
		const minContent = total(sizeAxis("width", "min-content"));
		const maxContent = total(sizeAxis("width", "max-content"));
		inner.width = clamp(
			fitContent(availableInner.width, minContent, maxContent),
			innerMin.width,
			innerMax.width,
		);
		availableInner.width = inner.width;
		if (hasAutoRepeat("width")) grid = buildGrid();
	}
	const innerWidth = inner.width;
	const columns = sizeAxis("width", innerWidth);
	const columnPositions = trackPositions(
		columns.sizes,
		columns.gutters,
		innerWidth - total(columns),
		style.justifyContent ?? "flex-start",
	);
	const columnArea = (item: GridItem) => {
		const slot = item.slots.column;
		const first = slot.start as number;
		const last = first + slot.span - 1;
		return {
			start: columnPositions[first] as number,
			size:
				(columnPositions[last] as number) +
				(columns.sizes[last] as number) -
				(columnPositions[first] as number),
		};
	};

	// The width each item takes in its column area.
	for (const item of grid.items) {
		const cs = item.entry.style;
		const area = columnArea(item);
		item.areaWidth = area.size;
		item.margin = resolveEdges(cs.margin, area.size);
		const margins = item.margin.left + item.margin.right;
		const stretches =
			item.justify === "stretch" &&
			cs.size.width.kind === "auto" &&
			cs.aspectRatio === undefined &&
			!item.autoMargin.left &&
			!item.autoMargin.right;
		if (stretches) {
			item.width = clamp(
				area.size - margins,
				resolve(cs.minSize.width, area.size),
				resolve(cs.maxSize.width, area.size),
			);
		} else {
			item.width = compute(item.entry, {
				known: { width: undefined, height: undefined },
				parentSize: { width: area.size, height: undefined },
				available: {
					width: Math.max(0, area.size - margins),
					height: "max-content",
				},
				perform: false,
			}).width;
		}
	}

	/* ----------------------------------------------------------------- rows */

	if (inner.height === undefined) {
		inner.height = clamp(
			total(sizeAxis("height", "max-content")),
			innerMin.height,
			innerMax.height,
		);
	}
	const innerHeight = inner.height;
	const rows = sizeAxis("height", innerHeight);
	const rowPositions = trackPositions(
		rows.sizes,
		rows.gutters,
		innerHeight - total(rows),
		style.alignContent,
	);

	const width = innerWidth + inset.width;
	const height = innerHeight + inset.height;
	if (!perform) return { width, height };

	/* ------------------------------------------------------ writing boxes */

	const contentLeft = border.left + padding.left;
	const contentTop = border.top + padding.top;
	for (const item of grid.items) {
		const child = item.entry;
		const cs = child.style;
		const rowSlot = item.slots.row;
		const firstRow = rowSlot.start as number;
		const lastRow = firstRow + rowSlot.span - 1;
		const areaTop = rowPositions[firstRow] as number;
		const areaHeight =
			(rowPositions[lastRow] as number) +
			(rows.sizes[lastRow] as number) -
			areaTop;
		const column = columnArea(item);
		const margin = { ...item.margin };
		const marginHeight = margin.top + margin.bottom;
		const stretches =
			item.align === "stretch" &&
			cs.size.height.kind === "auto" &&
			cs.aspectRatio === undefined &&
			!item.autoMargin.top &&
			!item.autoMargin.bottom;
		const stretchedHeight = stretches
			? clamp(
					areaHeight - marginHeight,
					resolve(cs.minSize.height, areaHeight),
					resolve(cs.maxSize.height, areaHeight),
				)
			: undefined;
		const size = compute(child, {
			known: { width: item.width, height: stretchedHeight },
			parentSize: { width: column.size, height: areaHeight },
			available: {
				width: item.width,
				height: stretchedHeight ?? Math.max(0, areaHeight - marginHeight),
			},
			perform: true,
		});

		const place = (
			areaStart: number,
			areaSize: number,
			itemSize: number,
			startMargin: number,
			endMargin: number,
			autoStart: boolean,
			autoEnd: boolean,
			alignment: SelfAlign,
		): [offset: number, startMargin: number, endMargin: number] => {
			const free =
				areaSize -
				itemSize -
				(autoStart ? 0 : startMargin) -
				(autoEnd ? 0 : endMargin);
			if ((autoStart || autoEnd) && free > 0) {
				const share = free / (autoStart && autoEnd ? 2 : 1);
				const start = autoStart ? share : startMargin;
				const end = autoEnd ? share : endMargin;
				return [areaStart + start, start, end];
			}
			const start = autoStart ? 0 : startMargin;
			const end = autoEnd ? 0 : endMargin;
			if (alignment === "end") {
				return [areaStart + areaSize - end - itemSize, start, end];
			}
			if (alignment === "center") {
				return [areaStart + start + free / 2, start, end];
			}
			return [areaStart + start, start, end];
		};
		const [x, marginLeft, marginRight] = place(
			column.start,
			column.size,
			size.width,
			margin.left,
			margin.right,
			item.autoMargin.left,
			item.autoMargin.right,
			item.justify,
		);
		const [y, marginTop, marginBottom] = place(
			areaTop,
			areaHeight,
			size.height,
			margin.top,
			margin.bottom,
			item.autoMargin.top,
			item.autoMargin.bottom,
			item.align,
		);
		const offset = relativeOffset(child, {
			width: column.size,
			height: areaHeight,
		});
		child.box = {
			...child.box,
			x: contentLeft + x + offset.width,
			y: contentTop + y + offset.height,
			margin: {
				top: marginTop,
				right: marginRight,
				bottom: marginBottom,
				left: marginLeft,
			},
		};
	}

	layoutAbsolute(absolute, compute, {
		width,
		height,
		border,
		// The static position is in the padding box: padding does not inset it.
		padding: { top: 0, right: 0, bottom: 0, left: 0 },
		mainStart: "left",
		crossStart: "top",
		row: true,
		justifyContent:
			style.justifyItems === "end"
				? "flex-end"
				: style.justifyItems === "center"
					? "center"
					: "flex-start",
		alignItems: style.alignItems,
	});

	entry.box = { ...entry.box, width, height, padding, border };
	return { width, height };
}
