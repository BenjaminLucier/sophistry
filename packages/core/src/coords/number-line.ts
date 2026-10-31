/**
 * `numberLine`: a single axis, its ticks and its numbers (Manim's
 * `NumberLine`), and `unitInterval`, its preset over `[0, 1]`.
 */

import type {
	Point,
	Range,
	RangeTransition,
	Scale,
	ScaleSpec,
	ScaleTicks,
	TickFormatterSpec,
	TimeZone,
	TipShape,
	WeightedTick,
} from "../geometry";
import {
	axisTicks,
	currentRange,
	isRangeTransition,
	resolveScale,
	spacedTicks,
	thinTickLabels,
	tickStep,
	transitionTicks,
} from "../geometry";
import type { Readable } from "../reactive";
import { derive } from "../reactive";
import type { CompositeContext } from "../scene/composite";
import { defineComposite } from "../scene/composite";
import { Invalidate } from "../scene/context";
import { measuresText } from "../scene/fonts";
import type { ShapeProps } from "../scene/shape";
import { shapeProps } from "../scene/shape";
import type { TextHalo } from "../scene/text";
import { label } from "../scene/text";
import type {
	PropDescriptor,
	PropsDescriptor,
	SceneNode,
} from "../scene/types";
import { arrow, line } from "../shapes/line";
import { flatColor } from "../spec/gradient";
import type { Vec2 } from "../spec/layout";
import { ORIGIN } from "../spec/layout";
import { measureLabel } from "../spec/metrics";
import {
	anchoredLabelProps,
	axisFormatter,
	DEFAULT_NUMBER_FONT_SIZE,
	DEFAULT_NUMBER_GAP,
	DEFAULT_TICK_SIZE,
	numberStyle,
} from "./axis-labels";
import type { CoordinateSystem } from "./coords";
import { createPhases, crossingValue, publishCoords } from "./coords";
import { sameRange, stablePoint } from "./grid-lines";

/** Spacing, in scene units, at which a tick fading in or out mid-rescale is gone (whole at twice it). */
const TICK_MIN_GAP = 0.15;

/** Minor ticks read as subdivisions, so they are visibly shorter. */
const MINOR_TICK_RATIO = 0.55;
const DEFAULT_TIP_LENGTH = 0.24;

/** Line, then ticks, then numbers — the order you would draw an axis in. */
const PHASES = 3;

/**
 * The shape props a number line hands straight to its line and ticks: every
 * one but the transform (the line places itself) and `progress` (spent in
 * phases).
 */
type NumberLineStyleProps = Omit<
	ShapeProps,
	"x" | "y" | "rotation" | "scale" | "origin" | "progress"
>;

/**
 * Props for {@link numberLine}. Style props (`stroke`, `strokeWidth`, `opacity`, `zIndex`, ...) come from the shape props and apply to the line and its ticks.
 *
 * @category Coordinate systems & graphs
 */
export interface NumberLineProps extends NumberLineStyleProps {
	/**
	 * Data range as `[min, max, step?]` — Manim's `x_range`. The optional step
	 * is the major tick spacing; if omitted a readable step is chosen.
	 *
	 * Or a transition, `{ from, to, t }`, to animate the domain from one
	 * track: the line maps through the range blended at `t`
	 * (`interpolateRange`), and its ticks and numbers cross-fade by value
	 * (`transitionTicks`) — those on both axes stay and slide, the old axis's
	 * fade out, the new one's fade in. Each end's numbers are thinned for that
	 * end's spacing, so nothing pops mid-way.
	 */
	range: Range | RangeTransition;
	/**
	 * How values map along the line: `"linear"` (the default), `"log"`,
	 * `"sqrt"`, `"symlog"`, `"time"`/`"utc"` (epoch milliseconds), or a `Scale`
	 * of your own. `"log"` needs a wholly positive range. A scale with its own
	 * ticks (log takes decades, time takes calendar intervals) ignores
	 * `step`, and `minorTickCount` can only switch its minors off with `0`.
	 */
	scale?: ScaleSpec;
	/**
	 * Log base. Only meaningful when `scale` is `"log"`.
	 * @default 10
	 */
	base?: number;
	/**
	 * The time zone a `"time"`/`"utc"` axis reads in: an IANA name
	 * (`"America/New_York"`), `"UTC"` or `"local"`. Its ticks land on that
	 * zone's midnights, month starts and hours, through daylight saving
	 * time, and its numbers are its wall-clock times. Omitted, `"utc"` reads
	 * in UTC and `"time"` in the viewer's zone. Only meaningful on a time
	 * scale; the data stays instants either way.
	 */
	timeZone?: TimeZone;
	/** Length of the whole line in scene units. */
	length: number;
	/** Centre of the line: the *midpoint of the range* lands here, not zero. */
	center?: Point;
	/** Radians, anticlockwise. `Math.PI / 2` is a vertical axis. */
	rotation?: number;
	/**
	 * Draw tick marks.
	 * @default true
	 */
	ticks?: boolean;
	/**
	 * Half-length of a major tick.
	 * @default 0.1
	 */
	tickSize?: number;
	/** Major tick spacing in data units, overriding the one in `range`. */
	step?: number;
	/**
	 * Subdivisions drawn *between* consecutive major ticks. None by default.
	 * @default 0
	 */
	minorTickCount?: number;
	/** Half-length of a minor tick. Defaults to 55% of `tickSize`. */
	minorTickSize?: number;
	/** Defaults to true — an unlabelled axis is rarely what you meant. */
	numbers?: boolean;
	/** Exactly these values get a number, instead of the major ticks. */
	numbersToInclude?: number[];
	/** Data values that get no number even if they are major ticks. */
	numbersToExclude?: number[];
	/**
	 * Scales a number's opacity, 0..1, on top of the axis's own and a range
	 * transition's fade: `(value) => (value === 0 ? 0.5 : 1)`. A number at 0
	 * is invisible but still laid out (unlike `numbersToExclude`, it keeps its
	 * place in overlap thinning), so a label can fade without the others
	 * moving. Called on every update. Defaults to 1 for every number.
	 */
	numberOpacity?: (value: number) => number;
	/** Fixed width for every number. Omitted, each is written as short as it can be. */
	decimalPlaces?: number;
	/**
	 * How a tick's number is written: a built-in name (`"plain"`, `"si"`,
	 * `"scientific"`, `"percent"`, `"piMultiple"`), a format string (a
	 * d3-format specifier such as `",.2f"`, `".0%"` or `"$.2s"`; a
	 * d3-time-format one such as `"%b %Y"` on a time axis), or your own
	 * `(value, decimalPlaces?) => string`. `decimalPlaces` is passed through, so
	 * `formatTick(value, decimalPlaces)` gives the default text to decorate (the
	 * hook `complexPlane` uses to turn 2 into "2i"). Defaults to `"plain"`.
	 */
	tickFormat?: TickFormatterSpec;
	/**
	 * Font size of the numbers.
	 * @default 0.3
	 */
	numberFontSize?: number;
	/**
	 * Drop numbers that would overlap their neighbours, keeping every second
	 * (then fourth, ...) so the survivors stay evenly spaced. Ignored when
	 * `numbersToInclude` names the numbers. Defaults to true.
	 */
	numberOverlap?: boolean;
	/**
	 * Gap between the tick's outer end and the number.
	 * @default 0.14
	 */
	numberGap?: number;
	/**
	 * Which side the numbers sit on. Below by default, carried round by `rotation`.
	 * @default "below"
	 */
	numberDirection?: Vec2;
	/**
	 * An outline in the background colour around each number (`true`, or a
	 * {@link TextHalo}), so numbers stay readable where they cross a filled
	 * layer. Defaults to none; `chart` turns it on over a covering layer.
	 */
	numberHalo?: boolean | TextHalo;
	/**
	 * Draw an arrow tip at the `range[1]` end.
	 * @default false
	 */
	tip?: boolean;
	/**
	 * Tip shape when `tip` is set.
	 * @default `"triangle"`
	 */
	tipShape?: TipShape;
	/**
	 * Tip length in scene units when `tip` is set.
	 * @default 0.24
	 */
	tipLength?: number;
	/**
	 * Reveal amount, 0..1, spent line, then ticks, then numbers.
	 * @default 1
	 */
	progress?: number;
	/** Placed inside this line's coordinate context. */
	children?: readonly SceneNode[];
}

/** The shape-prop keys a number line passes through to its line and ticks. */
const STYLE_KEYS = (Object.keys(shapeProps) as (keyof ShapeProps)[]).filter(
	(key) =>
		key !== "x" &&
		key !== "y" &&
		key !== "rotation" &&
		key !== "scale" &&
		key !== "origin" &&
		key !== "progress",
) as (keyof NumberLineStyleProps)[];

/**
 * The style props' descriptor entries, rerunning the composite's `update`
 * (which passes them on to its shapes) instead of a shape stage.
 */
function passThrough<P>(keys: readonly (keyof P)[], from: object) {
	const entries: Record<string, PropDescriptor<unknown>> = {};
	for (const key of keys) {
		const entry = (from as Record<string, PropDescriptor<unknown>>)[
			key as string
		] as PropDescriptor<unknown>;
		entries[key as string] = {
			default: entry.default,
			kind: entry.kind,
			invalidates: Invalidate.UPDATE,
		};
	}
	return entries as unknown as PropsDescriptor<Pick<P, (typeof keys)[number]>>;
}

/** The style-prop entries every axis composite shares. @internal */
export const numberLineStyleProps: PropsDescriptor<NumberLineStyleProps> =
	passThrough<NumberLineStyleProps>(STYLE_KEYS, shapeProps);

/** The number line's own props (everything but the range), for presets. */
const ownProps = {
	...numberLineStyleProps,
	scale: { invalidates: Invalidate.UPDATE },
	base: { default: 10, invalidates: Invalidate.UPDATE },
	timeZone: { invalidates: Invalidate.UPDATE },
	length: { invalidates: Invalidate.UPDATE },
	center: { invalidates: Invalidate.UPDATE },
	rotation: { default: 0, invalidates: Invalidate.UPDATE },
	ticks: { default: true, invalidates: Invalidate.UPDATE },
	tickSize: { default: DEFAULT_TICK_SIZE, invalidates: Invalidate.UPDATE },
	step: { invalidates: Invalidate.UPDATE },
	minorTickCount: { default: 0, invalidates: Invalidate.UPDATE },
	minorTickSize: { invalidates: Invalidate.UPDATE },
	numbers: { default: true, invalidates: Invalidate.UPDATE },
	numbersToInclude: { invalidates: Invalidate.UPDATE },
	numbersToExclude: { invalidates: Invalidate.UPDATE },
	numberOpacity: { invalidates: Invalidate.UPDATE },
	decimalPlaces: { invalidates: Invalidate.UPDATE },
	tickFormat: { invalidates: Invalidate.UPDATE },
	numberFontSize: {
		default: DEFAULT_NUMBER_FONT_SIZE,
		invalidates: Invalidate.UPDATE,
	},
	numberOverlap: { default: true, invalidates: Invalidate.UPDATE },
	numberGap: { default: DEFAULT_NUMBER_GAP, invalidates: Invalidate.UPDATE },
	numberDirection: { invalidates: Invalidate.UPDATE },
	numberHalo: { invalidates: Invalidate.UPDATE },
	tip: { default: false, invalidates: Invalidate.UPDATE },
	tipShape: { default: "triangle", invalidates: Invalidate.UPDATE },
	tipLength: { default: DEFAULT_TIP_LENGTH, invalidates: Invalidate.UPDATE },
	// Children bind to the phases derived from it: no update needed.
	progress: { default: 1, invalidates: Invalidate.NONE },
	children: { kind: "children", invalidates: Invalidate.NONE },
} satisfies Omit<PropsDescriptor<NumberLineProps>, "range">;

/** The cached layout of a transition's two ends, compared by value. */
interface EndLayout {
	from: Range;
	to: Range;
	/** Everything else the layout read, compared element by element. */
	inputs: readonly unknown[];
	fromTicks: ScaleTicks;
	toTicks: ScaleTicks;
	fromNumbers: number[];
	toNumbers: number[];
	fromFormat: (value: number, decimalPlaces?: number) => string;
	toFormat: (value: number, decimalPlaces?: number) => string;
	fromOnly: Set<number>;
	toOnly: Set<number>;
}

/** What a number line keeps between updates. */
interface NumberLineState {
	phase: (index: number) => Readable<number>;
	/** `progress` for the numbers: written whole once their phase starts. */
	numbersShown: Readable<number>;
	coordsFor: (
		min: number,
		max: number,
		step: number | undefined,
		centerX: number,
		centerY: number,
		length: number,
		rotation: number,
		scale: ScaleSpec | undefined,
		base: number | undefined,
		timeZone: TimeZone | undefined,
	) => { coords: CoordinateSystem; pointFor: (value: number) => Point };
	ends: EndLayout | null;
	/** The axis line: a `line`, or an `arrow` with `tip`. */
	axisLine: SceneNode | null;
	/** Each number's own opacity (before the reveal) and its bound opacity. */
	numberFades: Map<
		number,
		{ own: number | undefined; bound: Readable<number | undefined> }
	>;
}

/** Whether two input lists are the same, element by element. */
function sameInputs(a: readonly unknown[], b: readonly unknown[]): boolean {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (!Object.is(a[i], b[i])) return false;
	return true;
}

/** The mapping and coordinate system of one line frame. Immutable. */
function lineCoords(
	min: number,
	max: number,
	step: number | undefined,
	centerX: number,
	centerY: number,
	length: number,
	rotation: number,
	scale: ScaleSpec | undefined,
	base: number | undefined,
	timeZone: TimeZone | undefined,
): { coords: CoordinateSystem; pointFor: (value: number) => Point } {
	const range: Range = step === undefined ? [min, max] : [min, max, step];
	const mapping: Scale = resolveScale(scale, range, base, timeZone);
	const cos = Math.cos(rotation);
	const sin = Math.sin(rotation);
	const pointFor = (value: number): Point => {
		const along = (mapping.toUnit(value) - 0.5) * length;
		return { x: centerX + along * cos, y: centerY + along * sin };
	};
	const valueAt = (point: Point): number => {
		const along = (point.x - centerX) * cos + (point.y - centerY) * sin;
		return mapping.fromUnit(length === 0 ? 0 : along / length + 0.5);
	};
	const start = pointFor(min);
	const end = pointFor(max);
	const area = {
		minX: Math.min(start.x, end.x),
		minY: Math.min(start.y, end.y),
		maxX: Math.max(start.x, end.x),
		maxY: Math.max(start.y, end.y),
	};
	const crossing = { x: crossingValue(range), y: 0 };
	const coords: CoordinateSystem = Object.freeze({
		// A number line has no second axis, so the y component is always 0 and any
		// y handed to `coordsToPoint` is ignored rather than quietly displacing the point.
		coordsToPoint: (x: number) => pointFor(x),
		pointToCoords: (point: Point) => ({ x: valueAt(point), y: 0 }),
		xRange: () => range,
		yRange: (): Range => [0, 0],
		// The line itself is the only axis, so the crossing is the point on it
		// nearest zero — the same rule `axes` uses, with no second range.
		crossing: () => ({ ...crossing }),
		area: () => ({ ...area }),
	});
	return { coords, pointFor };
}

function createState(ctx: CompositeContext<NumberLineProps>): NumberLineState {
	const phase = createPhases(ctx.prop("progress"), PHASES);
	return {
		phase,
		numbersShown: derive(phase(2), (shown) => (shown > 0 ? 1 : 0)),
		coordsFor: ctx.memo(lineCoords),
		ends: null,
		axisLine: null,
		numberFades: new Map(),
	};
}

/** The shape props passed through, as they stand. */
function styleOf(props: Readonly<NumberLineProps>): NumberLineStyleProps {
	const style: Record<string, unknown> = {};
	for (const key of STYLE_KEYS) style[key] = props[key];
	return style as NumberLineStyleProps;
}

/**
 * Builds (or brings up to date) the line's children: the axis line, the
 * major and minor ticks, the numbers, then the caller's children, in
 * that order. Kept nodes are rewritten in place; writing an unchanged
 * prop costs nothing.
 */
function layout(
	ctx: CompositeContext<NumberLineProps>,
	state: NumberLineState,
	given: Range | RangeTransition,
): SceneNode[] {
	const props = ctx.props;
	const theme = ctx.theme;
	const fontEpoch = measuresText(ctx);
	const fontFamily = theme.defaults.fontFamily;
	const style = styleOf(props);

	/** The range shown now: `range` itself, or a transition's blend. */
	const range = currentRange(given, props.scale, props.base);
	const rotation = props.rotation ?? 0;
	const center = props.center ?? ORIGIN;
	const length = props.length;
	const { coords, pointFor } = state.coordsFor(
		range[0],
		range[1],
		range[2],
		center.x,
		center.y,
		length,
		rotation,
		props.scale,
		props.base,
		props.timeZone,
	);
	publishCoords(ctx, coords);

	/** Unit normal, pointing "up" from the line in its own frame. */
	const normal = { x: -Math.sin(rotation), y: Math.cos(rotation) };
	const start = pointFor(range[0]);
	const end = pointFor(range[1]);

	/**
	 * Both tick sequences from one call, so they come from the same rule as a
	 * plot's grid lines: the scale's own ticks when it has them (a log axis
	 * subdivides by decade, a time axis by calendar), uniform steps otherwise.
	 */
	const ticksFor = (at: Range) =>
		axisTicks(resolveScale(props.scale, at, props.base, props.timeZone), at, {
			step: props.step,
			minorTickCount: props.minorTickCount,
		});

	/** `values` without `numbersToExclude`. */
	const withoutExcluded = (values: number[], at: Range): number[] => {
		const excluded = props.numbersToExclude;
		if (!excluded || excluded.length === 0) return values;
		const tolerance = tickStep(at, { step: props.step }) * 1e-6;
		return values.filter(
			(value) => !excluded.some((skip) => Math.abs(skip - value) <= tolerance),
		);
	};

	/**
	 * The numbers that fit at range `at`: measured along the line (a label's
	 * width on a horizontal axis, its height on a vertical one) and thinned by
	 * parity until no two neighbours touch. Dates and long numbers crowd an
	 * axis long before ticks do.
	 */
	const thinnedAt = (values: number[], at: Range): number[] => {
		if (
			props.numberOverlap === false ||
			props.numbersToInclude !== undefined ||
			values.length < 2
		)
			return values;
		const fontSize = props.numberFontSize ?? DEFAULT_NUMBER_FONT_SIZE;
		const metrics = numberStyle(fontSize, fontFamily);
		const cos = Math.cos(rotation);
		const sin = Math.sin(rotation);
		const mapping = resolveScale(props.scale, at, props.base, props.timeZone);
		const format = axisFormatter(props, at);
		const along = (value: number) => (mapping.toUnit(value) - 0.5) * length;
		const extent = (value: number) => {
			const width = measureLabel(
				format(value, props.decimalPlaces),
				metrics,
			).width;
			return Math.abs(cos) * width + Math.abs(sin) * fontSize * 1.2;
		};
		const kept = thinTickLabels(
			values.map(along),
			values.map(extent),
			fontSize * 0.4,
		);
		return kept.length === values.length
			? values
			: kept.map((i) => values[i] as number);
	};

	/**
	 * The majors that get a number at range `at`: thinned for overlap over every major, then the
	 * excluded ones dropped, so leaving out the origin's "0" keeps 2, 4, 6 rather than shifting
	 * the thinning onto 1, 3, 5.
	 */
	const numbersAt = (majors: readonly number[], at: Range): number[] =>
		props.numbers === false
			? []
			: withoutExcluded(
					thinnedAt(props.numbersToInclude ?? [...majors], at),
					at,
				);

	/**
	 * A transition's one-end numbers faded by the room they have on this frame: each end's
	 * numbers are thinned for that end's spacing, so mid-way the end being squeezed (the old
	 * axis's 2, 4, 6, 8 as 0..10 grows to 0..100) would pile up. Each fades out as the gap to
	 * a neighbour on its own end closes, and is gone by the time they touch.
	 */
	const crowdFaded = (
		ticks: WeightedTick[],
		ends: EndLayout,
		at: Range,
		text: (value: number) => string,
	): WeightedTick[] => {
		if (props.numberOverlap === false || props.numbersToInclude !== undefined)
			return ticks;
		const fontSize = props.numberFontSize ?? DEFAULT_NUMBER_FONT_SIZE;
		const metrics = numberStyle(fontSize, fontFamily);
		const cos = Math.abs(Math.cos(rotation));
		const sin = Math.abs(Math.sin(rotation));
		const mapping = resolveScale(props.scale, at, props.base, props.timeZone);
		const along = (value: number) => mapping.toUnit(value) * length;
		const extent = (value: number) =>
			cos * measureLabel(text(value), metrics).width + sin * fontSize * 1.2;
		const gap = fontSize * 0.4;
		return ticks.map((tick) => {
			const own = ends.fromOnly.has(tick.value)
				? ends.fromNumbers
				: ends.toOnly.has(tick.value)
					? ends.toNumbers
					: undefined;
			if (!own || tick.weight <= 0) return tick;
			const index = own.indexOf(tick.value);
			const here = along(tick.value);
			const width = extent(tick.value);
			let clearance = Number.POSITIVE_INFINITY;
			for (const next of [own[index - 1], own[index + 1]]) {
				if (next === undefined) continue;
				const room = Math.abs(along(next) - here) - (width + extent(next)) / 2;
				clearance = Math.min(clearance, room);
			}
			const fit = Math.min(1, Math.max(0, clearance / gap));
			return fit >= 1 ? tick : { value: tick.value, weight: tick.weight * fit };
		});
	};

	let majorTicks: WeightedTick[];
	let minorTicks: WeightedTick[];
	let numberTicks: WeightedTick[];
	let labelText: (value: number) => string;

	if (isRangeTransition(given)) {
		/**
		 * A transition's two ends, compared by value: a caller usually writes
		 * `{ from: [0, 10], to: [0, 100], t: blend() }` inline, so the objects
		 * are new every frame while the ends are not — and everything measured
		 * at the ends (their ticks, their thinned numbers) is measured once per
		 * transition, not once per frame.
		 */
		const inputs = [
			props.scale,
			props.base,
			props.timeZone,
			props.step,
			props.minorTickCount,
			props.numbers,
			props.numbersToInclude,
			props.numbersToExclude,
			props.numberOverlap,
			props.numberFontSize,
			props.decimalPlaces,
			props.tickFormat,
			rotation,
			length,
			fontFamily,
			fontEpoch,
		];
		let ends = state.ends;
		if (
			!ends ||
			!sameRange(ends.from, given.from) ||
			!sameRange(ends.to, given.to) ||
			!sameInputs(ends.inputs, inputs)
		) {
			const fromTicks = ticksFor(given.from);
			const toTicks = ticksFor(given.to);
			const fromNumbers = numbersAt(fromTicks.majors, given.from);
			const toNumbers = numbersAt(toTicks.majors, given.to);
			ends = {
				from: given.from,
				to: given.to,
				inputs,
				fromTicks,
				toTicks,
				fromNumbers,
				toNumbers,
				fromFormat: axisFormatter(props, given.from),
				toFormat: axisFormatter(props, given.to),
				fromOnly: new Set(fromNumbers.filter((v) => !toNumbers.includes(v))),
				toOnly: new Set(toNumbers.filter((v) => !fromNumbers.includes(v))),
			};
			state.ends = ends;
		}
		const at = ends;
		const t = given.t;
		// Ticks partway in or out make way where the squeezed end bunches them.
		const mapping = resolveScale(
			props.scale,
			range,
			props.base,
			props.timeZone,
		);
		const along = (value: number) => mapping.toUnit(value) * length;
		majorTicks = spacedTicks(
			transitionTicks(at.fromTicks.majors, at.toTicks.majors, t, range),
			along,
			TICK_MIN_GAP,
		);
		minorTicks = spacedTicks(
			transitionTicks(at.fromTicks.minors, at.toTicks.minors, t, range),
			along,
			TICK_MIN_GAP,
		);
		numberTicks = transitionTicks(at.fromNumbers, at.toNumbers, t, range);
		/**
		 * How numbers are written during a transition: by the ends' formatters —
		 * never the blended range's, whose tick step (and so a format string's
		 * precision) changes as it runs, rewriting labels mid-way: a number only
		 * the old axis has keeps the old formatting, one only the new axis has
		 * takes the new, and one both have switches once, at the midpoint, if
		 * the two write it differently.
		 */
		labelText = (value) => {
			const useFrom = at.fromOnly.has(value)
				? true
				: at.toOnly.has(value)
					? false
					: t < 0.5;
			return (useFrom ? at.fromFormat : at.toFormat)(
				value,
				props.decimalPlaces,
			);
		};
		numberTicks = crowdFaded(numberTicks, at, range, labelText);
	} else {
		state.ends = null;
		const ticks = ticksFor(range);
		const full = (value: number) => ({ value, weight: 1 });
		majorTicks = ticks.majors.map(full);
		minorTicks = ticks.minors.map(full);
		numberTicks = numbersAt(ticks.majors, range).map(full);
		const format = axisFormatter(props, range);
		labelText = (value) => format(value, props.decimalPlaces);
	}

	/** A tick's `opacity`: the axis's own, dimmed by the tick's fade. */
	const fadeOf = (weight: number) =>
		weight >= 1 ? props.opacity : (props.opacity ?? 1) * weight;
	/** A number's `opacity`: its tick's, times `numberOpacity`. */
	const numberFadeOf = (tick: WeightedTick) => {
		const own = props.numberOpacity?.(tick.value);
		const fade = fadeOf(tick.weight);
		return own === undefined || own === 1
			? fade
			: (fade ?? 1) * Math.min(1, Math.max(0, own));
	};

	const tickSize = props.tickSize ?? DEFAULT_TICK_SIZE;
	const minorSize = props.minorTickSize ?? tickSize * MINOR_TICK_RATIO;

	/** Ticks straddle the line, so a tick is two half-lengths of `normal`. */
	const tickEnds = (value: number, size: number): [Point, Point] => {
		const at = pointFor(value);
		return [
			{ x: at.x - normal.x * size, y: at.y - normal.y * size },
			{ x: at.x + normal.x * size, y: at.y + normal.y * size },
		];
	};

	/** "Below" the line in its own frame — the negative normal, rotated with it. */
	const numberDirection = props.numberDirection ?? {
		x: -normal.x,
		y: -normal.y,
	};

	/**
	 * Numbers inherit an explicitly-set stroke colour so an accent-coloured axis
	 * reads as one object, but never inherit `"none"` — that would hide them.
	 * A gradient-stroked axis falls back too: text takes one colour, and picking
	 * a point on someone else's ramp to be that colour would be a guess.
	 */
	const stroke = flatColor(props.stroke, "none");
	const labelColor = stroke !== "none" ? stroke : theme.palette.foreground;

	// The axis line: an arrow with `tip`, a plain line otherwise.
	const wantsArrow = props.tip === true;
	const lineProps = {
		...style,
		from: stablePoint(state.axisLine?.get("from" as never), start),
		to: stablePoint(state.axisLine?.get("to" as never), end),
		progress: state.phase(0),
	};
	if (state.axisLine && (state.axisLine.type === "Arrow") !== wantsArrow) {
		state.axisLine.dispose();
		state.axisLine = null;
	}
	if (wantsArrow) {
		const arrowProps = {
			...lineProps,
			tipShape: props.tipShape ?? "triangle",
			tipLength: props.tipLength ?? DEFAULT_TIP_LENGTH,
		};
		if (state.axisLine) state.axisLine.update(arrowProps as never);
		else state.axisLine = arrow.create(arrowProps);
	} else if (state.axisLine) state.axisLine.update(lineProps as never);
	else state.axisLine = line.create(lineProps);

	// Keyed by value: a tick both ends share is the same node all the way
	// through, so it slides rather than being torn down and rebuilt.
	const tickNodes = (slot: string, ticks: WeightedTick[], size: number) =>
		ctx.list(slot, props.ticks === false ? [] : ticks, {
			key: (tick) => tick.value,
			create: (tick) => {
				const [from, to] = tickEnds(tick.value, size);
				return line.create({
					...style,
					from,
					to,
					opacity: fadeOf(tick.weight),
					progress: state.phase(1),
				});
			},
			update: (node, tick) => {
				const [from, to] = tickEnds(tick.value, size);
				node.update({
					...style,
					from: stablePoint(node.get("from"), from),
					to: stablePoint(node.get("to"), to),
					opacity: fadeOf(tick.weight),
				});
			},
		});
	const majors = tickNodes("majors", majorTicks, tickSize);
	const minors = tickNodes("minors", minorTicks, minorSize);

	const gap = (props.numberGap ?? DEFAULT_NUMBER_GAP) + tickSize;
	const fontSize = props.numberFontSize ?? DEFAULT_NUMBER_FONT_SIZE;
	/**
	 * A number's bound opacity: faded in whole rather than written on (a
	 * number half written reads as another number, "30" as "3"), so it
	 * follows the numbers' phase. Rebound only when its own fade changes.
	 */
	const fades = new Map<
		number,
		{ own: number | undefined; bound: Readable<number | undefined> }
	>();
	const opacityOf = (tick: WeightedTick) => {
		const own = numberFadeOf(tick);
		const previous = state.numberFades.get(tick.value);
		const entry =
			previous && Object.is(previous.own, own)
				? previous
				: {
						own,
						bound: derive(state.phase(2), (shown) =>
							shown >= 1 ? own : (own ?? 1) * shown,
						),
					};
		fades.set(tick.value, entry);
		return entry.bound;
	};
	const numberOptions = (tick: WeightedTick) => ({
		text: labelText(tick.value),
		at: pointFor(tick.value),
		direction: numberDirection,
		gap,
		fontSize,
		color: labelColor,
		zIndex: props.zIndex,
		halo: props.numberHalo,
	});
	const numbers = ctx.list("numbers", numberTicks, {
		key: (tick) => tick.value,
		create: (tick) =>
			label.create({
				...anchoredLabelProps(numberOptions(tick), fontFamily),
				opacity: opacityOf(tick),
				progress: state.numbersShown,
			}),
		update: (node, tick) => {
			node.update({
				...anchoredLabelProps(
					numberOptions(tick),
					fontFamily,
					node.get("place"),
				),
				opacity: opacityOf(tick),
				progress: state.numbersShown,
			});
		},
	});
	state.numberFades = fades;

	return [state.axisLine, ...majors, ...minors, ...numbers, ...ctx.children];
}

/**
 * The number line's setup and update, over a way of reading its range (a
 * preset fills in its own default).
 */
function numberLineOptions(
	rangeOf: (props: Readonly<NumberLineProps>) => Range | RangeTransition,
) {
	const states = new WeakMap<object, NumberLineState>();
	return {
		setup: (ctx: CompositeContext<NumberLineProps>) => {
			const state = createState(ctx);
			states.set(ctx.node, state);
			return layout(ctx, state, rangeOf(ctx.props));
		},
		update: (_changed: unknown, ctx: CompositeContext<NumberLineProps>) =>
			layout(ctx, states.get(ctx.node) as NumberLineState, rangeOf(ctx.props)),
	};
}

const numberLineLifecycle = numberLineOptions((props) => props.range);

/**
 * A single axis: a line, its ticks, and its numbers — Manim's `NumberLine`.
 *
 * Use it on its own for a 1D picture (number lines, intervals, parametrisations)
 * or let {@link axes} compose two of them. Like `axes`, it publishes a
 * coordinate system to its children (`coordsContext`; `coordsOf(node)` from
 * outside), so a function graph or a dot placed via `coordsToPoint` works
 * along the line; the system's y is always 0.
 *
 * The range's midpoint sits at `center`, so the line is centred on itself rather
 * than on its zero; where zero falls is then a property of the range, which is
 * what makes `[3, 8]` behave sensibly. `rotation` is baked into the geometry
 * rather than applied as a transform, so the numbers stay upright on a vertical
 * axis and `coordsToPoint` stays exact.
 *
 * `progress` is spent line → ticks → numbers, so `draw()` draws it the way a
 * person would. Every prop can be written or bound.
 *
 * @example
 * ```ts
 * import { coordsOf, createScene, numberLine } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const axis = scene.add(numberLine.create({ range: [-5, 5, 1], length: 10 }));
 * coordsOf(axis)?.coordsToPoint(2); // { x: 2, y: 0 }
 * axis.set("range", [0, 10, 2]);
 * ```
 *
 * @see {@link axes} for a pair of lines with a shared plotting area.
 * @category Coordinate systems & graphs
 */
export const numberLine = defineComposite<NumberLineProps>({
	name: "NumberLine",
	props: {
		...ownProps,
		range: { invalidates: Invalidate.UPDATE },
	},
	setup: numberLineLifecycle.setup,
	update: numberLineLifecycle.update,
});

/** @category Coordinate systems & graphs */
export type UnitIntervalProps = Omit<NumberLineProps, "range"> & {
	/** Overrides the preset's `[0, 1, 0.25]`. */
	range?: Range;
};

/** The preset's range, one array for good. */
const UNIT_RANGE: Range = [0, 1, 0.25];

const unitIntervalLifecycle = numberLineOptions(
	(props) => props.range ?? UNIT_RANGE,
);

/**
 * A {@link numberLine} preset over `[0, 1]` with a tick every 0.25, the axis
 * every parametrisation demo starts with. Pass `range` to override.
 *
 * @example
 * ```ts
 * import { createScene, unitInterval } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.add(unitInterval.create({ length: 6 }));
 * ```
 *
 * @category Coordinate systems & graphs
 */
export const unitInterval = defineComposite<UnitIntervalProps>({
	name: "UnitInterval",
	props: {
		...ownProps,
		range: { default: UNIT_RANGE, invalidates: Invalidate.UPDATE },
	},
	setup: unitIntervalLifecycle.setup as never,
	update: unitIntervalLifecycle.update as never,
});
