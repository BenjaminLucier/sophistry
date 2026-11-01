/**
 * Props shared by chart marks, documented once here: the data transition
 * (`to`, `blend`, `staging`, `enterStagger`, `key`), the staggered reveal
 * (`stagger`) and the named reveal styles. A mark re-declares a prop only
 * where its meaning is narrower.
 */

import type { BandKey } from "@sophistry/core/geometry";
import type { Channel } from "./data/channels.js";
import type { JoinStaging } from "./math/join.js";

/**
 * Order for `stagger` and `enterStagger`: `"position"` follows the mark's own
 * layout (along x, by value, by category); `"random"` shuffles by a hash of
 * each datum's `key`, the same every frame, so it scrubs.
 *
 * @see https://sophistry.dev/guides/chart-animation/#reveals
 * @category Charts
 */
export type StaggerOrder = "position" | "random";

/**
 * How a curve-like mark (`<LinePlot>`, `<Ecdf>`, `<Stairs>`, `<FillBetween>`)
 * reveals: `"x"` sweeps left to right, `"length"` draws along its arc length.
 *
 * @see https://sophistry.dev/guides/chart-animation/#reveals
 * @category Charts
 */
export type CurveReveal = "x" | "length";

/** How `<Density>` reveals: `"x"` sweeps in along x, `"grow"` rises from the baseline. @category Charts */
export type DensityReveal = "x" | "grow";

/** How `<StackPlot>` reveals: `"grow"` from the baseline, `"x"` along x, `"length"` by arc length. @category Charts */
export type StackReveal = "grow" | "x" | "length";

/** How bars reveal: `"grow"` out of their foot, `"stack"` scaled about zero together, `"fade"` in place. @category Charts */
export type BarReveal = "grow" | "stack" | "fade";

/** How a radial mark (`<PieChart>`, `<RadarChart>`) reveals: `"grow"` out from the centre, `"sweep"` round the turn. @category Charts */
export type RadialReveal = "grow" | "sweep";

/** How a frame's layers reveal: `"layers"` each its own way, `"x"` behind one shared front. @category Charts */
export type LayersReveal = "layers" | "x";

/**
 * A mark's data transition from `data` to `to`, driven by `blend`.
 *
 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
 * @category Charts
 */
export interface TransitionProps<T> {
	/**
	 * The data to transition to. Marks in both `data` and `to` move, marks only
	 * in `to` enter, marks only in `data` exit. At `blend` 0 the chart shows
	 * `data`, at 1 it shows `to`.
	 */
	to?: readonly T[];
	/** Transition progress from `data` (0) to `to` (1). @default 0 */
	blend?: number;
	/**
	 * How `blend` is spent: `"staged"` runs exit, then move, then enter, each
	 * eased (so drive `blend` linearly); `"together"` runs all at once, linearly.
	 * @default "staged"
	 */
	staging?: JoinStaging;
	/**
	 * Fraction of the enter stage spent staggering entering marks in `to`'s
	 * order, 0..0.95; 0 enters them together. Moves and exits never stagger.
	 * @default 0
	 */
	enterStagger?: number;
}

/**
 * {@link TransitionProps} for a per-datum mark, matching data between the
 * two ends by `key`.
 *
 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
 * @category Charts
 */
export interface KeyedTransitionProps<T> extends TransitionProps<T> {
	/**
	 * Each mark's identity: a key of `T` or `(d, i) => key`. A datum with the
	 * same key keeps its mark across updates and transitions. Defaults to the datum's index.
	 */
	key?: Channel<T, BandKey>;
}

/**
 * {@link TransitionProps} for a mark drawing one shape per `series` (lines,
 * curves, areas): shapes are matched by `series` and morphed.
 *
 * @see https://sophistry.dev/guides/chart-animation/#data-transitions
 * @category Charts
 */
export interface SeriesTransitionProps<T> extends TransitionProps<T> {
	/** As {@link TransitionProps.staging}, with series morphing in the move stage. @default "staged" */
	staging?: JoinStaging;
	/**
	 * Fraction of the enter stage spent staggering entering series in `to`'s
	 * order, 0..0.95; each sweeps in over its own share. Moves and exits never
	 * stagger.
	 * @default 0
	 */
	enterStagger?: number;
}

/**
 * A mark's staggered reveal.
 *
 * @see https://sophistry.dev/guides/chart-animation/#reveals
 * @category Charts
 */
export interface RevealProps {
	/**
	 * Fraction of the reveal spent staggering one mark after the next, 0..0.95;
	 * 0 reveals all marks together.
	 * @default 0
	 */
	stagger?: number;
}

function keysOf<P>() {
	return <const K extends readonly (keyof P)[]>(
		keys: K & ([Exclude<keyof P, K[number]>] extends [never] ? unknown : never),
	): K => keys;
}

/** Checks at compile time that a key list names every key of `P` and nothing else. */
export const TRANSITION_KEYS = keysOf<TransitionProps<unknown>>()([
	"to",
	"blend",
	"staging",
	"enterStagger",
]);

/** {@link KeyedTransitionProps}' keys. */
export const KEYED_TRANSITION_KEYS = keysOf<KeyedTransitionProps<unknown>>()([
	...TRANSITION_KEYS,
	"key",
]);

/** {@link RevealProps}' keys. */
export const REVEAL_KEYS = keysOf<RevealProps>()(["stagger"]);

/**
 * The datum type chart definitions are declared over. A definition is one
 * value (`scatter`), not a generic function, so its props cannot follow the
 * type of `data`; over `any`, a channel key is any string and a channel
 * function receives the datum untyped. Annotate the function's parameter
 * (`(d: Row) => d.sales`) for checked reads.
 *
 * @category Channels
 */
// biome-ignore lint/suspicious/noExplicitAny: definitions cannot be generic over the datum.
export type AnyDatum = any;
