/**
 * What the box and violin presets share: reading each group's sample and
 * name (and, with `to`, the far end's), laying the groups out in band slots
 * (one per group, or one per name with a `series`), each group's identity
 * across a keyed transition, and the props of the `chart` the preset draws
 * in. Internal.
 */

import type { SceneNode } from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import type { BandKey, Point, Range } from "@sophistry/core/geometry";
import type { Channel } from "../data/channels.js";
import { identity, resolveChannel } from "../data/channels.js";
import type { ChartProps, ChartYAxisOptions } from "../frame/types.js";
import type { JoinStaging } from "../math/join.js";
import { autoRange } from "../math/range.js";
import { deepEqual, shallowEqual } from "../util.js";

/** Gap between dodged boxes or violins, as a fraction of each one's sub-slot. */
export const DODGE_GAP = 0.1;

/** The band-axis categories of a box or violin plot, and each datum's. */
export interface SlotKeys {
	categories: BandKey[];
	/** The categories are the names (so the axis writes the key); else indices. */
	named: boolean;
	of: (index: number) => BandKey;
}

/**
 * The band-axis categories of a box or violin plot, and each datum's: one per datum, or with a
 * `series` and names, one per distinct name.
 *
 * @internal
 */
export function slotKeys(
	series: unknown,
	labels: readonly (string | undefined)[] | undefined,
	data: readonly unknown[],
): SlotKeys {
	if (series === undefined || !labels) {
		return {
			categories: data.map((_, i) => i),
			named: false,
			of: (index) => index,
		};
	}
	return {
		categories: [...new Set(labels)] as BandKey[],
		named: true,
		of: (index) => labels[index] as BandKey,
	};
}

/** Both ends' slots of a box or violin plot under a keyed transition. @internal */
export interface TransitionSlots {
	from: { categories: BandKey[]; of: (index: number) => BandKey };
	to: { categories: BandKey[]; of: (index: number) => BandKey };
	/** The categories are the names (so the axis writes the key); else indices. */
	named: boolean;
	/** Groups sharing a slot stand side by side, one sub-slot per series. */
	dodge: boolean;
}

/**
 * Both ends' slots for a keyed transition, as {@link slotKeys}, except that names unique within
 * each end become the slots, so a moving group keeps its name on the axis.
 *
 * @internal
 */
function transitionSlots(
	series: unknown,
	fromLabels: readonly (string | undefined)[] | undefined,
	toLabels: readonly (string | undefined)[] | undefined,
	from: readonly unknown[],
	to: readonly unknown[],
): TransitionSlots {
	const unique = (labels: readonly (string | undefined)[]) =>
		labels.every((label) => label !== undefined && label !== null) &&
		new Set(labels).size === labels.length;
	if (
		series === undefined &&
		fromLabels &&
		toLabels &&
		unique(fromLabels) &&
		unique(toLabels)
	) {
		const own = (labels: readonly (string | undefined)[]) => ({
			categories: labels as BandKey[],
			of: (index: number) => labels[index] as BandKey,
		});
		return {
			from: own(fromLabels),
			to: own(toLabels),
			named: true,
			dodge: false,
		};
	}
	const a = slotKeys(series, fromLabels, from);
	const b = slotKeys(series, toLabels, to);
	return { from: a, to: b, named: a.named, dodge: a.named };
}

/**
 * A box or violin group's identity across a keyed transition: its name and series together.
 * Undefined without a `label` (groups are then keyed by place within series, else index).
 *
 * @internal
 */
function groupKey<T>(
	label: Channel<T, string> | undefined,
	series: Channel<T, BandKey> | undefined,
): Channel<T, BandKey> | undefined {
	const name = resolveChannel(label, undefined, "label");
	if (!name) return undefined;
	const group = resolveChannel(series, undefined, "series");
	return (d, i) => {
		const own = name(d, i);
		if (!group) return own;
		const of = group(d, i);
		return `${String(own)}\u0001${typeof of}:${String(of)}`;
	};
}

/** What a box or violin layer needs to transition to `to`. @internal */
export interface GroupTransition<T> {
	to: readonly T[];
	/** Each `to` datum's sample. */
	groups: readonly (readonly number[])[];
	slots: TransitionSlots;
	/** Each group's identity (see `groupKey`), or undefined to key by series, else index. */
	key: Channel<T, BandKey> | undefined;
}

/** What a box or violin preset reads from its props on one update. */
export interface GroupData<T> {
	/** Each datum's sample. */
	groups: (readonly number[])[];
	/** Each datum's name, with a `label`. */
	labels: (string | undefined)[] | undefined;
	/** One slot per group (by index), or with a series and names, one per name. */
	slots: SlotKeys;
	/** With `to`: both ends' slots. */
	ends: TransitionSlots | undefined;
	/** Every group's values fitted to a range (zero included), read once per data change. */
	fitted(): Range;
	/** With `to`: a band category's name on the axis. */
	nameOf(key: BandKey): string;
	/** With `to`: what the inner layer needs of the far end (the same object while unchanged). */
	transition: GroupTransition<T> | undefined;
}

/** The props {@link createGroupData}'s function reads. */
export interface GroupDataProps<T> {
	data: readonly T[];
	to?: readonly T[];
	blend?: number;
	values?: Channel<T, readonly number[]>;
	label?: Channel<T, string>;
	series?: Channel<T, BandKey>;
}

/** A last-input cache over arguments compared by identity. */
function lastCall<A extends unknown[], R>(
	fn: (...args: A) => R,
): (...args: A) => R {
	let last: { args: A; value: R } | undefined;
	return (...args) => {
		if (last && shallowEqual(last.args, args)) return last.value;
		const value = fn(...args);
		last = { args, value };
		return value;
	};
}

/**
 * Reads a box or violin preset's groups, names and (with `to`) the far end's, and lays out both
 * ends' slots. Call once, in `setup`; call the result in each `update`. Each read is cached by
 * the data and channels it depends on, so a frame of a `blend` or `progress` reads nothing again.
 *
 * @internal
 */
export function createGroupData<T>(): (
	props: GroupDataProps<T>,
) => GroupData<T> {
	const samplesOf = (
		data: readonly T[],
		values: Channel<T, readonly number[]> | undefined,
	) => {
		const read = resolveChannel<T, readonly number[]>(
			values,
			identity,
			"values",
		);
		return data.map((d, i) => (read(d, i) as readonly number[]) ?? []);
	};
	const labelsOf = (
		data: readonly T[],
		label: Channel<T, string> | undefined,
	) => {
		const read = resolveChannel(label, undefined, "label");
		return read ? data.map((d, i) => read(d, i)) : undefined;
	};
	const groups = lastCall(samplesOf);
	const toGroups = lastCall(samplesOf);
	const labels = lastCall(labelsOf);
	const toLabels = lastCall(labelsOf);
	const slots = lastCall(slotKeys);
	const ends = lastCall(transitionSlots);
	const keyOf = lastCall(groupKey<T>);
	const fit = lastCall((own: readonly (readonly number[])[]) =>
		autoRange(own.flat()),
	);
	let transition: GroupTransition<T> | undefined;
	return (props) => {
		const own = groups(props.data, props.values);
		const names = labels(props.data, props.label);
		const far =
			props.to === undefined ? undefined : toGroups(props.to, props.values);
		const farNames =
			props.to === undefined ? undefined : toLabels(props.to, props.label);
		const both =
			props.to === undefined
				? undefined
				: ends(props.series, names, farNames, props.data, props.to);
		const key = keyOf(props.label, props.series);
		const next =
			props.to === undefined || !far || !both
				? undefined
				: { to: props.to, groups: far, slots: both, key };
		if (
			!(next && transition && shallowEqual(next, transition)) &&
			next !== transition
		)
			transition = next;
		const blend = props.blend ?? 0;
		return {
			groups: own,
			labels: names,
			slots: slots(props.series, names, props.data),
			ends: both,
			fitted: () => fit(own),
			nameOf: (category) => {
				if (!both || both.named) return String(category);
				// Slots by index: the name at the nearer end.
				const near = blend < 0.5;
				const index = Number(category);
				const mine = names?.[index];
				const theirs = farNames?.[index];
				return (near ? (mine ?? theirs) : (theirs ?? mine)) ?? "";
			},
			transition,
		};
	};
}

/** The preset props the frame of a box or violin plot reads. */
export interface PresetFrameProps {
	width: number;
	height: number;
	center?: Point;
	yRange?: Range;
	legend?: boolean | "right" | "top";
	series?: unknown;
	colors?: readonly ColorInput[];
	yAxis?: boolean | ChartYAxisOptions;
	progress?: number;
	zIndex?: number;
	visible?: boolean;
}

/**
 * A band category's name on a box or violin plot's x axis: with `to`, the
 * name at the nearer end; with names as slots, the key; else the datum's
 * label.
 *
 * @internal
 */
export function categoryName(
	read: GroupData<unknown>,
	key: BandKey,
	index: number,
): string {
	if (read.ends) return read.nameOf(key);
	return read.slots.named ? String(key) : (read.labels?.[index] ?? "");
}

/**
 * The props of the `chart` a box or violin preset draws in: a band x axis
 * over the slots (named by the labels), a value y axis fitted to every
 * sample (both ends' under a transition, through the layer's report).
 *
 * @param band - The band axis options the preset adds (padding, font size,
 *   line), and its `categoryLabel` (keep it one function for the preset's
 *   life, reading the latest groups, so the axis options compare equal).
 * @internal
 */
export function presetChartProps(
	props: PresetFrameProps,
	read: GroupData<unknown>,
	band: {
		padding?: number;
		numberFontSize: number;
		numberGap?: number;
		line: boolean;
		categoryLabel: (key: BandKey, index: number) => string;
	},
): Partial<ChartProps> {
	const ends = read.ends;
	return {
		width: props.width,
		height: props.height,
		center: props.center,
		// Under a transition the layer reports both ends and the frame fits them.
		yRange: props.yRange ?? (ends ? undefined : read.fitted()),
		legend: props.legend,
		color:
			props.series !== undefined && props.colors
				? { range: props.colors as readonly string[] }
				: undefined,
		xAxis: {
			scale: "band",
			categories: ends ? undefined : read.slots.categories,
			...(band.padding === undefined ? {} : { padding: band.padding }),
			categoryLabel: band.categoryLabel,
			numbers: read.labels !== undefined,
			numberFontSize: band.numberFontSize,
			...(band.numberGap === undefined ? {} : { numberGap: band.numberGap }),
			line: band.line,
		} as ChartProps["xAxis"],
		yAxis: {
			// `false` hides the axis; an object's own `visible` wins.
			visible: props.yAxis !== false,
			...(typeof props.yAxis === "object" ? props.yAxis : {}),
		},
		progress: props.progress,
		zIndex: props.zIndex,
		visible: props.visible,
	};
}

/**
 * Writes the props of `next` that differ by structure from `last` (functions
 * by identity) to `node`, so a preset's update leaves its chart alone when
 * nothing it passes changed. Returns `next`, the new `last`.
 *
 * @internal
 */
export function updateChanged<P extends object>(
	node: SceneNode<P>,
	next: Partial<P>,
	last: Partial<P> | undefined,
	same: (a: unknown, b: unknown) => boolean = deepEqual,
): Partial<P> {
	const changed: Partial<P> = {};
	let any = false;
	for (const key of Object.keys(next) as (keyof P)[]) {
		if (last && same(next[key], last[key])) continue;
		changed[key] = next[key];
		any = true;
	}
	if (any) node.update(changed as never);
	return next;
}

/** The staging props a preset passes through to its layer. */
export interface PresetTransitionProps {
	blend?: number;
	staging?: JoinStaging;
	enterStagger?: number;
}
