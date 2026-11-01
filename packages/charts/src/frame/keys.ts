/**
 * What a `chart`'s keys show: the colour scale and its legend, the size
 * keys, and the colour bar's ramp, all from the layers' steady reports.
 *
 * {@link createChartKeys} is made once per chart; its function runs in
 * every chart update and keeps each result's identity while it is equal,
 * so the legend and the layers see nothing new while only a blend moves.
 * The size-scale helpers are shared with a chart group's guides.
 */

import type { ColorInput } from "@sophistry/core/color";
import type { BandKey } from "@sophistry/core/geometry";
import { cssColor } from "@sophistry/core/internal";
import type { Theme } from "@sophistry/core/themes";
import type { JoinStages, StageWindow } from "../math/join.js";
import { keyWindow } from "../math/join.js";
import type { OrdinalColorScale } from "../math/ordinal.js";
import { ordinalColorScale, uniqueKeys } from "../math/ordinal.js";
import { keyedMemo, shallowEqual, stableValue } from "../util.js";
import { sameData } from "./reports.js";
import type {
	ChartLayerExtent,
	ChartProps,
	ChartSizeLegendOptions,
	LegendMark,
	RampExtent,
	SharedSizeDomain,
	SizeExtent,
} from "./types.js";

/** One legend entry (as `legend` takes it). */
export interface FrameLegendEntry {
	key?: BandKey;
	label: string;
	color: ColorInput;
	mark?: LegendMark;
}

/** A legend's keyed transition (as `legend` takes it). */
export interface FrameLegendTransition {
	from: readonly BandKey[];
	to: readonly BandKey[];
	exit: number;
	update: number;
	enter: number;
}

/** The stages a stack of size keys transitions on (as `sizeKeyStack` takes them). */
export interface FrameSizeKeyStages {
	exit: number;
	update: number;
	enter: number;
}

/** No size keys: one shared empty list, so a chart without sized layers keeps one identity. */
const NO_SIZE_KEYS: readonly SizeExtent[] = [];

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

/** The legend swatch over every reporting layer: every layer's mark, merged. */
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

/** What one update of a chart's keys reads. */
export interface ChartKeysInput {
	props: Readonly<ChartProps>;
	theme: Theme;
	/** The steady reports (identity kept while unchanged). */
	reports: readonly ChartLayerExtent[];
	/** Whether a keyed transition runs (steady while its blend moves). */
	transitioning: boolean;
	/** How far a stage of the transition has got. */
	stage(pick: (stages: JoinStages) => StageWindow): number;
	/** A chart group's colour scale, which wins over the chart's own. */
	groupColorScale?: OrdinalColorScale;
	/** A chart group's shared size domain, which wins over the chart's own. */
	groupSizeDomain?: SharedSizeDomain;
	/** The chart is a group's panel. */
	grouped?: boolean;
}

/** A chart's keys on one update; every field keeps its identity while equal. */
export interface ChartKeys {
	colorScale: OrdinalColorScale;
	legendEntries: readonly FrameLegendEntry[];
	legendPosition: "right" | "top" | undefined;
	legendEnds: { from: readonly BandKey[]; to: readonly BandKey[] } | undefined;
	legendTransition: FrameLegendTransition | undefined;
	sizeDomain: SharedSizeDomain | undefined;
	sizeOptions: ChartSizeLegendOptions;
	sizeKeys: readonly SizeExtent[];
	sizePosition: "right" | "top" | undefined;
	/** Where the frame's keys go (the colour legend and the size key): their shared side. */
	guidesPosition: "right" | "top" | undefined;
	sizeStages: FrameSizeKeyStages | undefined;
	ramp: RampExtent | undefined;
}

const NO_SIZE_OPTIONS: ChartSizeLegendOptions = {};

/**
 * The colour scale, legend, size keys and colour bar ramp of a chart. Make
 * one per chart in `setup`; call the result in every update.
 */
export function createChartKeys(): (input: ChartKeysInput) => ChartKeys {
	const domainStable = stableValue<readonly BandKey[]>(shallowEqual);
	const legendOrderStable = stableValue<readonly BandKey[]>(shallowEqual);
	const rangeStable = stableValue<readonly string[]>(shallowEqual);
	const scaleMemo = keyedMemo<OrdinalColorScale>();
	const markStable = stableValue<LegendMark>(shallowEqual);
	const markMemo = keyedMemo<LegendMark>();
	const entriesStable = stableValue<readonly FrameLegendEntry[]>(
		(a, b) =>
			a.length === b.length &&
			a.every(
				(entry, i) =>
					entry.key === b[i]?.key &&
					entry.label === b[i]?.label &&
					entry.color === b[i]?.color &&
					entry.mark === b[i]?.mark,
			),
	);
	const entriesMemo = keyedMemo<readonly FrameLegendEntry[]>();
	const endsMemo = keyedMemo<ChartKeys["legendEnds"]>();
	const endsStable = stableValue<ChartKeys["legendEnds"]>(
		(a, b) =>
			a === b ||
			(!!a && !!b && shallowEqual(a.from, b.from) && shallowEqual(a.to, b.to)),
	);
	const legendTransitionStable = stableValue<FrameLegendTransition | undefined>(
		(a, b) =>
			a === b ||
			(!!a &&
				!!b &&
				a.exit === b.exit &&
				a.update === b.update &&
				a.enter === b.enter &&
				a.from === b.from &&
				a.to === b.to),
	);
	const sizeDomainMemo = keyedMemo<SharedSizeDomain | undefined>();
	const sizeDomainStable = stableValue<SharedSizeDomain | undefined>(
		sameSizeDomain,
	);
	const sizeKeysMemo = keyedMemo<readonly SizeExtent[]>();
	const sizeKeysStable = stableValue<readonly SizeExtent[]>(
		(a, b) => a === b || sameData(a, b),
	);
	const sizeStagesStable = stableValue<FrameSizeKeyStages | undefined>(
		(a, b) =>
			a === b ||
			(!!a &&
				!!b &&
				a.exit === b.exit &&
				a.update === b.update &&
				a.enter === b.enter),
	);
	const rampStable = stableValue<RampExtent | undefined>(
		(a, b) =>
			a === b ||
			(a !== undefined &&
				b !== undefined &&
				a.colormap === b.colormap &&
				a.scale === b.scale &&
				a.domain[0] === b.domain[0] &&
				a.domain[1] === b.domain[1]),
	);

	return (input) => {
		const { props, reports, stage } = input;
		/** The given domain, then every layer's categories in the order first seen. */
		const colorDomain = domainStable(
			uniqueKeys([
				...(props.color?.domain ?? []),
				...reports.flatMap((report) => report.color?.categories ?? []),
			]),
		);
		const given = props.color?.range;
		const colorRange = rangeStable(
			given?.length ? given.map(cssColor) : input.theme.palette.series,
		);
		const colorScale =
			input.groupColorScale ??
			scaleMemo([colorDomain, colorRange], () =>
				ordinalColorScale(colorDomain, colorRange),
			);
		const legendMark = markStable(
			markMemo([reports], () => mergedLegendMark(reports)),
		);
		const label = props.color?.label;
		/**
		 * The order the legend lists the domain in: as the layers ask (a stack's top band
		 * first), then the rest in colour order. Compared by value, so a frame that leaves it
		 * alone keeps the entries.
		 */
		const legendKeys = legendOrderStable(
			legendOrderOf(
				colorScale.domain,
				reports.some((report) => report.color?.legendOrder)
					? reports.flatMap(
							(report) =>
								report.color?.legendOrder ?? report.color?.categories ?? [],
						)
					: undefined,
			),
		);
		const legendEntries = entriesStable(
			entriesMemo([colorScale, label, legendMark, legendKeys], () =>
				legendKeys.map((key) => {
					const index = colorScale.domain.indexOf(key);
					return {
						key,
						label: label ? label(key, index) : String(key),
						color: colorScale(key),
						mark: legendMark,
					};
				}),
			),
		);
		let legendPosition: "right" | "top" | undefined;
		if (props.legend !== false && legendEntries.length > 0) {
			// A panel's legend keys the group's scale, but only for a panel that
			// colours by it.
			if (!input.grouped || reports.some((report) => report.color))
				legendPosition = props.legend === "top" ? "top" : "right";
		}
		/**
		 * Which entries each end of a keyed transition lists (from
		 * `color.ends`; a category no layer reports at either end stays at
		 * both). Undefined unless a transitioning layer reports its ends.
		 */
		const legendEnds = endsStable(
			endsMemo([input.transitioning, reports, legendEntries], () => {
				if (!input.transitioning) return undefined;
				const from = new Set<BandKey>();
				const to = new Set<BandKey>();
				let ends = false;
				for (const report of reports) {
					const color = report.color;
					if (!color) continue;
					if (color.ends) ends = true;
					for (const key of color.ends?.from ?? color.categories) from.add(key);
					for (const key of color.ends?.to ?? color.categories) to.add(key);
				}
				if (!ends) return undefined;
				const keys = legendEntries.flatMap((entry) =>
					entry.key === undefined ? [] : [entry.key],
				);
				const pinned = (key: BandKey) => !from.has(key) && !to.has(key);
				/** Each end listed in its own preferred order, so a reorder slides. */
				const orderAt = (end: "from" | "to", listed: BandKey[]) =>
					reports.some((report) => report.color?.legendOrders)
						? legendOrderOf(
								listed,
								reports.flatMap(
									(report) =>
										report.color?.legendOrders?.[end] ??
										report.color?.legendOrder ??
										report.color?.categories ??
										[],
								),
							)
						: listed;
				return {
					from: orderAt(
						"from",
						keys.filter((key) => from.has(key) || pinned(key)),
					),
					to: orderAt(
						"to",
						keys.filter((key) => to.has(key) || pinned(key)),
					),
				};
			}),
		);
		const legendTransition = legendTransitionStable(
			legendEnds
				? {
						from: legendEnds.from,
						to: legendEnds.to,
						exit: stage((stages) => stages.exit),
						update: stage((stages) => stages.update),
						enter: stage((stages) => stages.enter),
					}
				: undefined,
		);

		/**
		 * The size scale this chart's sized layers share: its group's, else the
		 * greatest maximum its own layers report at each end (none under
		 * `scales: { size: "independent" }`).
		 */
		const ownSizeDomain = sizeDomainStable(
			sizeDomainMemo([props.scales?.size, reports], () =>
				props.scales?.size === "independent"
					? undefined
					: sharedSizeDomain(reports),
			),
		);
		const sizeDomain = input.groupSizeDomain ?? ownSizeDomain;
		const sizeOptions =
			typeof props.sizeLegend === "object" ? props.sizeLegend : NO_SIZE_OPTIONS;
		/** One size key per distinct scale the sized layers draw on, in layer order. */
		const sizeKeys = sizeKeysStable(
			sizeKeysMemo(
				[
					props.legend === false || props.sizeLegend === false,
					sizeDomain,
					reports,
				],
				() => {
					if (props.legend === false || props.sizeLegend === false)
						return NO_SIZE_KEYS;
					const keys = sizeKeysOf(
						reports.map((report) => report.size),
						(size) => onSharedSize(size, sizeDomain),
					);
					return keys.length > 0 ? keys : NO_SIZE_KEYS;
				},
			),
		);
		/** Where the size keys go: with the legend, beside or above the plot. */
		const sizePosition: "right" | "top" | undefined =
			sizeKeys.length > 0
				? props.legend === "top"
					? "top"
					: "right"
				: undefined;
		/** The stages the size keys blend on while a keyed transition rescales one. */
		const sizeStages = sizeStagesStable(
			input.transitioning && sizeKeys.some((key) => key.to !== undefined)
				? {
						exit: stage((stages) => keyWindow(stages.exit, stages.update)),
						update: stage((stages) => stages.update),
						enter: stage((stages) => keyWindow(stages.enter, stages.update)),
					}
				: undefined,
		);
		/** The colour bar's ramp: the first value-coloured layer's. */
		const ramp = rampStable(
			props.colorbar ? reports.find((report) => report.ramp)?.ramp : undefined,
		);
		return {
			colorScale,
			legendEntries,
			legendPosition,
			legendEnds,
			legendTransition,
			sizeDomain,
			sizeOptions,
			sizeKeys,
			sizePosition,
			guidesPosition: legendPosition ?? sizePosition,
			sizeStages,
			ramp,
		};
	};
}

/**
 * The legend's listing order over `domain`: the keys in `preferred` first, in its order, then
 * the rest in `domain`'s. No preference, `domain` itself.
 */
function legendOrderOf(
	domain: readonly BandKey[],
	preferred: readonly BandKey[] | undefined,
): readonly BandKey[] {
	if (!preferred) return domain;
	const known = new Set(domain);
	const listed = uniqueKeys(preferred.filter((key) => known.has(key)));
	const taken = new Set(listed);
	return [...listed, ...domain.filter((key) => !taken.has(key))];
}
