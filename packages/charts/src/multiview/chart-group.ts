/**
 * Frames that share scales: the store behind `chartLink`, `facet`,
 * `pairPlot` and `jointPlot`. Each `chart` inside registers as a panel;
 * panels with the same share key on an axis fit it to the union of their
 * reports, all colour through one scale, and with `shareSize` all sized
 * layers share one maximum. Nothing here draws. Internal.
 *
 * How it runs (one commit, as a chart and its layers do): a preset (or
 * `chartLink`) makes the store in `setup` and provides a
 * {@link ChartGroupScope} through {@link chartGroupContext}. A chart that
 * finds one joins as a panel ({@link chartPanel}): at the start of each of
 * its updates it publishes its layers' reports, then fits its shared axes to
 * the group's. A report that changed by value marks every other panel
 * (`ctx.invalidate`), which refit in the same commit; the panel's guide
 * room, axis spans and transition stages, published at the end of its
 * update, mark only the group's watchers (the preset laying the panels
 * out). Values equal to the last ones change nothing, so the loop settles.
 */

import type { CompositeContext, ContextKey } from "@sophistry/core";
import { createContextKey } from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { BandKey, Range, RangeTransition } from "@sophistry/core/geometry";
import { cssColor } from "@sophistry/core/internal";
import type {
	ChartLayerExtent,
	LegendMark,
	RampExtent,
	SharedSizeDomain,
	SizeExtent,
} from "../frame/types";
import type { JoinStages } from "../math/join";
import type { OrdinalColorScale } from "../math/ordinal";
import { ordinalColorScale, uniqueKeys } from "../math/ordinal";
import { deepEqual, shallowEqual } from "../util";

/** Room a panel's guides take on each side of its plotting area, in scene units. */
export interface PanelRoom {
	left: number;
	right: number;
	top: number;
	bottom: number;
}

/** Which scales a panel shares: panels with the same key on an axis fit it together. */
export interface PanelKeys {
	x?: string;
	y?: string;
	/** Axes where the panel takes the shared fit without adding its data (a joint plot's marginals). */
	follows?: { x?: boolean; y?: boolean };
}

/** Where a panel sits in its preset's grid, when it has one. */
export interface PanelPlace {
	/** Grid row, from the top. */
	readonly row: number;
	/** Grid column, from the left. */
	readonly column: number;
}

/** A panel's own state, as it last published it. */
export interface PanelState {
	/** The panel's own layers' reports, a keyed transition's blend held out (its `t` reads 0). */
	reports: readonly ChartLayerExtent[];
	/** The blend of the panel's first transitioning layer, if any. */
	blend: number | undefined;
	/** The panel could draw on its own (its layers have reported). */
	ready: boolean;
	/** The room its guides take around the plot. */
	room: PanelRoom;
	/** The stages of the keyed transition its frame runs, if any (the group's guides follow them). */
	stages: JoinStages | undefined;
	/**
	 * Each axis's range length in its own units (band count, data span,
	 * decades on a log axis), independent of panel size, for `facet`'s `space="free"`.
	 */
	span: { x: number; y: number } | undefined;
}

/** A panel as the group sees it: its keys, place and last published state. */
export interface GroupPanel {
	readonly keys: PanelKeys;
	readonly place: PanelPlace | undefined;
	readonly state: Readonly<PanelState>;
}

/** A panel's link to its group: what it publishes, and leaving. */
export interface GroupMember {
	/**
	 * Publishes what the other panels read: the panel's reports and its
	 * transition's blend. Marks the other panels and the watchers when it
	 * changed. Call at the start of the panel's update, before reading the
	 * group's shared fits.
	 */
	publishReports(reports: readonly ChartLayerExtent[], blend?: number): void;
	/**
	 * Publishes what only the preset reads (room, spans, stages, readiness).
	 * Marks the watchers when it changed by value.
	 */
	publishLayout(
		layout: Partial<Pick<PanelState, "room" | "span" | "stages" | "ready">>,
	): void;
	/** Leaves the group; the others refit. */
	dispose(): void;
}

/** The colour scale options a group takes (`ChartColorOptions`). */
export interface GroupColorOptions {
	domain?: readonly BandKey[];
	range?: readonly ColorInput[];
	label?: (key: BandKey, index: number) => string;
}

/** Options for {@link createChartGroup}, set again on every update of the owner. */
export interface ChartGroupOptions {
	color?: GroupColorOptions;
	/** A range every panel sharing x (under any key) takes, unless it gives its own. */
	xRange?: Range | RangeTransition;
	/** A range every panel sharing y takes, unless it gives its own. */
	yRange?: Range | RangeTransition;
	/**
	 * Give every panel's sized layers one size scale: the greatest maximum any
	 * reports. A layer pinning `sizeMaxValue` keeps its own.
	 * @default false
	 */
	shareSize?: boolean;
	/** The colours a scale without `color.range` cycles: the theme's series colours. */
	palette?: readonly string[];
}

/** One legend entry of a group's shared legend. */
export interface GroupLegendEntry {
	key: BandKey;
	label: string;
	color: string;
	mark: LegendMark;
}

/** A group of panels sharing scales. */
export interface ChartGroup {
	/**
	 * Adds a panel. `onChange` is told (mark only) whenever something the
	 * panel reads from the group changed: another panel's reports, the
	 * options. Returns the panel's link.
	 */
	join(
		entry: { keys: PanelKeys; place?: PanelPlace },
		onChange: () => void,
	): GroupMember;
	/**
	 * Watches every change (the preset laying the panels out): `onChange` is
	 * told whenever any panel published something new. Returns unsubscribe.
	 */
	watch(onChange: () => void): () => void;
	/** Sets the options; a change marks every panel. */
	setOptions(options: ChartGroupOptions): void;
	/** The panels, in joining order. */
	panels(): readonly GroupPanel[];
	/** Every panel's reports (blends held out, as in {@link PanelState.reports}). */
	all(): readonly ChartLayerExtent[];
	/** The blend of the first panel in a keyed transition: the one the group stages on. */
	blend(): number | undefined;
	/** The reports of every panel sharing `key` on `axis`. */
	shared(axis: "x" | "y", key: string): readonly ChartLayerExtent[];
	/** The range given for an axis, for panels sharing it. */
	range(axis: "x" | "y"): Range | RangeTransition | undefined;
	/** The one colour scale; the same object while its domain and colours hold. */
	colorScale(): OrdinalColorScale;
	/** One entry per category of the colour scale, swatches merged over every panel's layers. */
	legendEntries(): readonly GroupLegendEntry[];
	/** The first value-coloured layer's ramp, for one colour bar. */
	ramp(): RampExtent | undefined;
	/** The size maximum every panel's sized layers share at each end; undefined unless sharing and some layer sizes by value. */
	sizeDomain(): SharedSizeDomain | undefined;
	/** A layer's size scale as it is drawn in this group: the shared maximum, unless it pins its own. */
	sizeOf(size: SizeExtent): SizeExtent;
	/** The stages of the panels' keyed transition (the first that has one), for the group's own guides. */
	stages(): JoinStages | undefined;
	/** Every panel is ready, so shared fits are complete. */
	ready(): boolean;
	/** The largest room any panel's guides take on each side. */
	room(): PanelRoom;
}

/**
 * What a panel finds in context: its group and its share keys.
 *
 * @category Extending
 */
export interface ChartGroupScope {
	group: ChartGroup;
	keys: PanelKeys;
	/** The panel's place in the grid, so the preset can tell its panels' rooms apart. */
	place?: PanelPlace;
}

/**
 * The group a `chart` is a panel of, or null. Presets provide it on a
 * container around each panel; `chartLink` provides it to its whole subtree.
 *
 * @category Extending
 */
export const chartGroupContext: ContextKey<ChartGroupScope | null> =
	createContextKey<ChartGroupScope | null>("chartGroup", null);

const NO_ROOM: PanelRoom = Object.freeze({
	left: 0,
	right: 0,
	top: 0,
	bottom: 0,
});
const NO_REPORTS: readonly ChartLayerExtent[] = Object.freeze([]);

/** Column widths (x) or row heights (y) for `space="free"`: each as long as the longest range among its panels. */
export function spanRatios(
	panels: readonly GroupPanel[],
	axis: "x" | "y",
	count: number,
): number[] {
	const out = Array.from({ length: count }, () => 0);
	for (const panel of panels) {
		const at = panel.place?.[axis === "x" ? "column" : "row"];
		const span = panel.state.span?.[axis];
		if (at === undefined || span === undefined || at >= count) continue;
		out[at] = Math.max(out[at] as number, span);
	}
	return out;
}

/** Two optional ratio lists with the same entries. */
export function sameRatios(
	a: readonly number[] | undefined,
	b: readonly number[] | undefined,
): boolean {
	return a === b || (!!a && !!b && shallowEqual(a, b));
}

/** The legend swatch over every reporting layer: what `chart` merges too. */
export function mergedLegendMark(
	reports: readonly ChartLayerExtent[],
): LegendMark {
	const mark: LegendMark = {};
	for (const report of reports) {
		if (!report.color) continue;
		const own = report.color.mark;
		if (!own || own.fill) mark.fill = true;
		if (own?.line) mark.line = true;
		if (own?.symbol && !mark.symbol) mark.symbol = own.symbol;
	}
	if (!mark.fill && !mark.line && !mark.symbol) mark.fill = true;
	return mark;
}

/**
 * One size scale over sized layers' reports: the greatest maximum at each
 * end (a pinned `sizeMaxValue` counts at both). Undefined when no layer
 * sizes by value.
 */
export function sharedSizeDomain(
	reports: readonly ChartLayerExtent[],
): SharedSizeDomain | undefined {
	let from = 0;
	let to = 0;
	let sized = false;
	for (const report of reports) {
		const size = report.size;
		if (!size) continue;
		sized = true;
		const near = size.maxValue;
		const far = size.to ?? size.maxValue;
		if (Number.isFinite(near)) from = Math.max(from, near);
		if (Number.isFinite(far)) to = Math.max(to, far);
	}
	return sized ? { from, to } : undefined;
}

/** Two shared size domains with the same ends. */
export function sameSizeDomain(
	a: SharedSizeDomain | undefined,
	b: SharedSizeDomain | undefined,
): boolean {
	return a === b || (!!a && !!b && a.from === b.from && a.to === b.to);
}

/** A layer's size scale on a shared one: the shared maximum at each end, unless the layer pins its own or nothing is shared. */
export function onSharedSize(
	size: SizeExtent,
	shared: SharedSizeDomain | undefined,
): SizeExtent {
	if (!shared || size.pinned) return size;
	return {
		...size,
		maxValue: shared.from,
		to: shared.to === shared.from ? undefined : shared.to,
	};
}

/**
 * A frame's size keys over its sized layers, in layer order: one per
 * distinct drawn scale, titled by its first layer's channel. With
 * `byRange` (a group's keys), one per distinct `sizeRange`, left out
 * unless its layers agree on the maximum.
 */
export function sizeKeysOf(
	sizes: readonly (SizeExtent | undefined)[],
	drawn: (size: SizeExtent) => SizeExtent,
	byRange = false,
): SizeExtent[] {
	const sized = (value: number | undefined): value is number =>
		value !== undefined && value > 0 && Number.isFinite(value);
	const keys: {
		range: readonly [number, number];
		/** The drawn maxima that tell keys apart (not `byRange`). */
		drawn: [number, number];
		label: string | undefined;
		from: number | undefined;
		to: number | undefined;
		near: boolean;
		far: boolean;
		agree: boolean;
	}[] = [];
	for (const size of sizes) {
		if (!size) continue;
		const near = sized(size.maxValue);
		const far = sized(size.to ?? size.maxValue);
		if (!near && !far) continue;
		const own = drawn(size);
		const from = own.maxValue;
		const to = own.to ?? own.maxValue;
		const sameRange = (range: readonly [number, number]) =>
			range[0] === own.range[0] && range[1] === own.range[1];
		let key = keys.find(
			(k) =>
				sameRange(k.range) &&
				(byRange || (k.drawn[0] === from && k.drawn[1] === to)),
		);
		if (!key) {
			key = {
				range: own.range,
				drawn: [from, to],
				label: own.label,
				from: undefined,
				to: undefined,
				near: false,
				far: false,
				agree: true,
			};
			keys.push(key);
		}
		if (near) {
			if (key.from === undefined) key.from = from;
			else if (key.from !== from) key.agree = false;
		}
		if (far) {
			if (key.to === undefined) key.to = to;
			else if (key.to !== to) key.agree = false;
		}
		key.near ||= near;
		key.far ||= far;
	}
	return keys
		.filter((key) => key.agree)
		.map((key) => {
			const start = key.near ? (key.from ?? 0) : 0;
			const end = key.far ? (key.to ?? 0) : 0;
			return {
				maxValue: start,
				range: key.range,
				label: key.label,
				...(end !== start ? { to: end } : {}),
			};
		});
}

/** One panel's record in the store. */
interface PanelRecord extends GroupPanel {
	state: PanelState;
	onChange: () => void;
}

/** Two ramps alike for a colour bar. */
function sameRamp(a: RampExtent | undefined, b: RampExtent | undefined) {
	return (
		a === b ||
		(a !== undefined &&
			b !== undefined &&
			a.colormap === b.colormap &&
			a.scale === b.scale &&
			a.domain[0] === b.domain[0] &&
			a.domain[1] === b.domain[1])
	);
}

/**
 * A group store. Make one in a composite's `setup`, give it its options in
 * every update ({@link ChartGroup.setOptions}), and provide a
 * {@link ChartGroupScope} through {@link chartGroupContext}; panels find it
 * there. Everything it computes is cached until a panel publishes or the
 * options change.
 */
export function createChartGroup(options: ChartGroupOptions = {}): ChartGroup {
	let own: ChartGroupOptions = options;
	const records: PanelRecord[] = [];
	const watchers = new Set<() => void>();
	/** Bumped when any panel's reports or the options change: what the caches key on. */
	let version = 0;
	let layoutVersion = 0;

	const cache = <T>(compute: () => T, equals?: (a: T, b: T) => boolean) => {
		let at = -1;
		let value: T;
		return (): T => {
			if (at === version) return value;
			const next = compute();
			if (at < 0 || !equals || !equals(value, next)) value = next;
			at = version;
			return value;
		};
	};
	const layoutCache = <T>(
		compute: () => T,
		equals?: (a: T, b: T) => boolean,
	) => {
		let at = -1;
		let value: T;
		return (): T => {
			const key = version * 1e6 + layoutVersion;
			if (at === key) return value;
			const next = compute();
			if (at < 0 || !equals || !equals(value, next)) value = next;
			at = key;
			return value;
		};
	};

	const notifyPanels = (except: PanelRecord | null) => {
		for (const record of records) if (record !== except) record.onChange();
	};
	const notifyWatchers = () => {
		for (const watcher of [...watchers]) watcher();
	};

	const all = cache((): readonly ChartLayerExtent[] => {
		const out: ChartLayerExtent[] = [];
		for (const record of records)
			for (const report of record.state.reports) out.push(report);
		return out;
	});
	const colorScale = cache(
		(): OrdinalColorScale => {
			const domain = uniqueKeys([
				...(own.color?.domain ?? []),
				...all().flatMap((report) => report.color?.categories ?? []),
			]);
			const given = own.color?.range;
			const range = given?.length
				? given.map((color) => cssColor(color))
				: (own.palette ?? []);
			return ordinalColorScale(domain, range);
		},
		(a, b) =>
			shallowEqual(a.domain, b.domain) && shallowEqual(a.range, b.range),
	);
	const legendMark = cache(() => mergedLegendMark(all()), shallowEqual);
	const legendEntries = cache(
		(): readonly GroupLegendEntry[] => {
			const scale = colorScale();
			const label = own.color?.label;
			const mark = legendMark();
			return scale.domain.map((key, index) => ({
				key,
				label: label ? label(key, index) : String(key),
				color: scale(key),
				mark,
			}));
		},
		(a, b) =>
			a.length === b.length &&
			a.every((entry, i) => {
				const other = b[i] as GroupLegendEntry;
				return (
					entry.key === other.key &&
					entry.label === other.label &&
					entry.color === other.color &&
					entry.mark === other.mark
				);
			}),
	);
	const ramp = cache(() => all().find((report) => report.ramp)?.ramp, sameRamp);
	const sizeDomain = cache(
		(): SharedSizeDomain | undefined =>
			own.shareSize ? sharedSizeDomain(all()) : undefined,
		sameSizeDomain,
	);
	const room = layoutCache((): PanelRoom => {
		const max = { ...NO_ROOM };
		for (const record of records) {
			const panel = record.state.room;
			max.left = Math.max(max.left, panel.left);
			max.right = Math.max(max.right, panel.right);
			max.top = Math.max(max.top, panel.top);
			max.bottom = Math.max(max.bottom, panel.bottom);
		}
		return max;
	}, shallowEqual);

	return {
		join(entry, onChange) {
			const record: PanelRecord = {
				keys: entry.keys,
				place: entry.place,
				onChange,
				state: {
					reports: NO_REPORTS,
					blend: undefined,
					ready: true,
					room: NO_ROOM,
					stages: undefined,
					span: undefined,
				},
			};
			records.push(record);
			let left = false;
			return {
				publishReports(reports, blend) {
					if (left) return;
					const state = record.state;
					if (state.reports === reports && state.blend === blend) return;
					const changed =
						state.reports !== reports && !deepEqual(state.reports, reports);
					if (!changed && state.blend === blend) {
						state.reports = reports;
						return;
					}
					state.reports = reports;
					state.blend = blend;
					version++;
					notifyPanels(record);
					notifyWatchers();
				},
				publishLayout(layout) {
					if (left) return;
					const state = record.state;
					let changed = false;
					if (layout.room && !shallowEqual(layout.room, state.room)) {
						state.room = { ...layout.room };
						changed = true;
					}
					if ("span" in layout && !shallowEqual(layout.span, state.span)) {
						state.span = layout.span ? { ...layout.span } : undefined;
						changed = true;
					}
					if ("stages" in layout && layout.stages !== state.stages) {
						state.stages = layout.stages;
						changed = true;
					}
					if (layout.ready !== undefined && layout.ready !== state.ready) {
						state.ready = layout.ready;
						changed = true;
					}
					if (!changed) return;
					layoutVersion++;
					notifyWatchers();
				},
				dispose() {
					if (left) return;
					left = true;
					const at = records.indexOf(record);
					if (at >= 0) records.splice(at, 1);
					version++;
					layoutVersion++;
					notifyPanels(null);
					notifyWatchers();
				},
			};
		},
		watch(onChange) {
			watchers.add(onChange);
			return () => watchers.delete(onChange);
		},
		setOptions(next) {
			if (deepEqual(own, next)) {
				own = next;
				return;
			}
			own = next;
			version++;
			notifyPanels(null);
			notifyWatchers();
		},
		panels: () => records,
		all,
		blend() {
			for (const record of records)
				if (record.state.blend !== undefined) return record.state.blend;
			return undefined;
		},
		shared(axis, key) {
			const out: ChartLayerExtent[] = [];
			for (const record of records) {
				if (record.keys[axis] !== key || record.keys.follows?.[axis]) continue;
				for (const report of record.state.reports) out.push(report);
			}
			return out;
		},
		range: (axis) => (axis === "x" ? own.xRange : own.yRange),
		colorScale,
		legendEntries,
		ramp,
		sizeDomain,
		sizeOf: (size) => onSharedSize(size, sizeDomain()),
		stages() {
			for (const record of records)
				if (record.state.stages) return record.state.stages;
			return undefined;
		},
		ready: () => records.every((record) => record.state.ready),
		room,
	};
}

/**
 * A chart's side of a group: the hook `chart` calls so it works as a panel.
 * Outside a group every method falls back to the chart's own state.
 *
 * In the chart's update, in this order:
 *
 * ```ts
 * const panel = state.panel.begin(reports, blend); // publishes; null outside a group
 * const xReports = state.panel.fitReports("x", reports);
 * const xGiven = numericRange(props.xRange) ?? state.panel.range("x");
 * const colorScale = state.panel.colorScale() ?? colorScaleOf(...);
 * const sizeDomain = state.panel.sizeDomain() ?? ownSizeDomain;
 * // ... fit, lay out, draw ...
 * state.panel.end({ room, span, stages, ready });
 * ```
 *
 * @category Extending
 */
export interface ChartPanel {
	/**
	 * Reads the group scope (joining or leaving as it changes) and publishes
	 * the chart's layers' reports. Returns the scope, or null outside a group.
	 */
	begin(
		reports: readonly ChartLayerExtent[],
		blend?: number,
	): ChartGroupScope | null;
	/** The reports an axis is fitted to: its share key's across the group, or the chart's own. */
	fitReports(
		axis: "x" | "y",
		own: readonly ChartLayerExtent[],
	): readonly ChartLayerExtent[];
	/** Every report a keyed transition stages on: the whole group's, or the chart's own. */
	allReports(own: readonly ChartLayerExtent[]): readonly ChartLayerExtent[];
	/** The group's range for an axis the chart shares, or undefined. */
	range(axis: "x" | "y"): Range | RangeTransition | undefined;
	/** The group's colour scale, or undefined outside a group. */
	colorScale(): OrdinalColorScale | undefined;
	/** The group's shared size domain, or undefined (outside, or not sharing). */
	sizeDomain(): SharedSizeDomain | undefined;
	/** The group's blend (the first transitioning panel's), or undefined. */
	blend(): number | undefined;
	/** Whether the chart is a panel (its legend is the group's, its room the group's to lay out). */
	readonly grouped: boolean;
	/** Publishes what the preset lays the panels out by. */
	end(
		layout: Partial<Pick<PanelState, "room" | "span" | "stages" | "ready">>,
	): void;
}

/** Why a chart's update reruns for its group: another panel or the options changed. */
export const GROUP_CHANGED: ContextKey<unknown> =
	createContextKey("chartGroupChanged");

/**
 * Makes a chart's {@link ChartPanel}. Call once, in the chart's `setup`.
 * Leaves the group when the chart is disposed.
 *
 * @category Extending
 */
export function chartPanel<P>(ctx: CompositeContext<P>): ChartPanel {
	let scope: ChartGroupScope | null = null;
	let member: GroupMember | null = null;
	ctx.onDispose(() => {
		member?.dispose();
		member = null;
	});
	const shares = (axis: "x" | "y") =>
		scope !== null && scope.keys[axis] !== undefined;
	return {
		begin(reports, blend) {
			const next = ctx.context(chartGroupContext);
			if (next !== scope) {
				member?.dispose();
				member = next
					? next.group.join(next, () => ctx.invalidate(GROUP_CHANGED))
					: null;
				scope = next;
			}
			member?.publishReports(reports, blend);
			return scope;
		},
		fitReports(axis, reports) {
			const key = scope?.keys[axis];
			return scope && key !== undefined
				? scope.group.shared(axis, key)
				: reports;
		},
		allReports: (reports) => (scope ? scope.group.all() : reports),
		range: (axis) => (shares(axis) ? scope?.group.range(axis) : undefined),
		colorScale: () => scope?.group.colorScale(),
		sizeDomain: () => scope?.group.sizeDomain(),
		blend: () => scope?.group.blend(),
		get grouped() {
			return scope !== null;
		},
		end(layout) {
			member?.publishLayout(layout);
		},
	};
}
