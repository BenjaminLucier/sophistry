/**
 * `animatedBoundary`: a coloured stroke running round an outline. It is a
 * composite of two `path` nodes (the growing stroke and the fading one under
 * it). Its state is a
 * pure function of time; the paths' paints, widths and reveal are bound to
 * `derive`s over the time (the `time` prop, else the clock's), so a tick
 * reruns only those and no `update`.
 */

import type { ColorInput } from "../color";
import type { Polyline } from "../geometry";
import { derive, type Track, track } from "../reactive";
import { defineComposite } from "../scene/composite";
import { Invalidate } from "../scene/context";
import { type ShapeProps, shapeProps } from "../scene/shape";
import type { PropsDescriptor } from "../scene/types";
import type { Theme } from "../themes/types";
import type { Easing } from "../tween/easing";
import { resolveEasing } from "../tween/easing";
import {
	forwardedProps,
	forwardHandlers,
	forwardProps,
	rawProp,
} from "./forward";
import { path } from "./path";
import { timeOf } from "./traced-path";

/** @category Shapes */
export interface AnimatedBoundaryProps
	extends Omit<ShapeProps, "stroke" | "fill" | "progress"> {
	/** The outline to run round, scene units: one ring or several. */
	points: Polyline | Polyline[];
	/**
	 * Treat the outline as closed rings.
	 * @default true
	 */
	closed?: boolean;
	/**
	 * Colours it cycles through, one per cycle. Defaults to the theme's first four series colours.
	 */
	colors?: readonly ColorInput[];
	/**
	 * Cycles per second. The default matches Manim's.
	 * @default 0.5
	 */
	cycleRate?: number;
	/**
	 * Draw every other cycle backwards, from the end.
	 * @default true
	 */
	backAndForth?: boolean;
	/**
	 * How each cycle's stroke draws on.
	 * @default `"smooth"`
	 */
	drawEasing?: Easing;
	/**
	 * How the previous cycle's stroke thins away.
	 * @default `"smooth"`
	 */
	fadeEasing?: Easing;
	/**
	 * Time in seconds. Defaults to the clock's time. Bind a timeline's time
	 * to tie the boundary to a script.
	 */
	time?: number;
}

/** The shape props both paths take as they are. */
const forwarded = forwardedProps<
	ShapeProps,
	"stroke" | "fill" | "progress" | "strokeWidth" | "visible"
>(shapeProps, ["stroke", "fill", "progress", "strokeWidth", "visible"]);
const forwardedKeys = Object.keys(forwarded) as (keyof AnimatedBoundaryProps)[];

const animatedBoundaryProps: PropsDescriptor<AnimatedBoundaryProps> = {
	...forwarded,
	// Everything below is read through the paths' `derive`s: no `update`.
	strokeWidth: { default: 0.05, invalidates: Invalidate.NONE },
	visible: { default: true, invalidates: Invalidate.NONE },
	points: { invalidates: Invalidate.NONE },
	closed: { default: true, invalidates: Invalidate.NONE },
	colors: { invalidates: Invalidate.NONE },
	cycleRate: { default: 0.5, invalidates: Invalidate.NONE },
	backAndForth: { default: true, invalidates: Invalidate.NONE },
	drawEasing: { default: "smooth", invalidates: Invalidate.NONE },
	fadeEasing: { default: "smooth", invalidates: Invalidate.NONE },
	time: { invalidates: Invalidate.NONE },
};

/** Both directions of the same outline: rings and their points reversed. */
function reversed(rings: Polyline[]): Polyline[] {
	return [...rings].reverse().map((ring) => [...ring].reverse());
}

/** One ring or several, as several. */
function ringsOf(points: Polyline | Polyline[]): Polyline[] {
	return Array.isArray(points[0])
		? (points as Polyline[])
		: [points as Polyline];
}

/**
 * `animatedBoundary`: a coloured stroke that keeps running round an outline,
 * each cycle in the next colour, while the last cycle's stroke thins away
 * underneath it: ambient emphasis for a region, after Manim's
 * `AnimatedBoundary`.
 *
 * It is a pure function of time, as Manim's updater is: at time `T`, the
 * cycle is `⌊T · cycleRate⌋`, the growing stroke is drawn `drawEasing` of
 * the way round in that cycle's colour (backwards on odd cycles, with
 * `backAndForth`), and the previous colour's full outline is
 * `1 − fadeEasing` of the stroke width. So it needs no animation to run, and
 * a `time` from a timeline scrubs it exactly. On the clock's own time it
 * keeps the clock running while it exists. Put it beside the shape it
 * outlines, with the shape's own points (a `rect`'s are `rectPolyline`).
 *
 * @example
 * ```ts
 * import { animatedBoundary, createScene } from "@sophistry/core";
 * import { rectPolyline } from "@sophistry/core/geometry";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(animatedBoundary.create({ points: rectPolyline(-1, -1, 2, 2) }));
 * ```
 *
 * @category Shapes
 */
export const animatedBoundary = defineComposite<AnimatedBoundaryProps>({
	name: "AnimatedBoundary",
	props: animatedBoundaryProps,
	setup: (ctx) => {
		const clock = ctx.clock;
		// A clock only ticks while something listens to it, and with no `play`
		// running nothing would: hold it open while this exists on its time.
		if (ctx.props.time === undefined) ctx.onDispose(clock.onTick(() => {}));

		// The theme, as a source the state can follow (`update` writes it).
		const theme = track(ctx.theme);
		themes.set(ctx.node, theme);

		const rings = derive(rawProp(ctx, "points"), ringsOf);
		const backwards = derive(rings, reversed);
		const closed = derive(rawProp(ctx, "closed"), (value) => value ?? true);
		const width = derive(rawProp(ctx, "strokeWidth"), (value) => value ?? 0.05);
		const state = derive(
			[
				timeOf(ctx, clock),
				rawProp(ctx, "colors"),
				rawProp(ctx, "cycleRate"),
				rawProp(ctx, "backAndForth"),
				rawProp(ctx, "drawEasing"),
				rawProp(ctx, "fadeEasing"),
				theme,
			],
			(now, given, cycleRate, backAndForth, drawEasing, fadeEasing, active) => {
				const colors =
					given && given.length > 0 ? given : active.palette.series.slice(0, 4);
				const time = now * (cycleRate ?? 0.5);
				const cycle = Math.max(0, Math.floor(time));
				const alpha = time - Math.floor(time);
				const n = colors.length || 1;
				const back = (backAndForth ?? true) && cycle % 2 === 1;
				return {
					drawn: resolveEasing(drawEasing)(alpha),
					fade: resolveEasing(fadeEasing)(alpha),
					color: colors[cycle % n] as ColorInput,
					previous: colors[(cycle - 1 + n) % n] as ColorInput,
					back,
					// Nothing to fade until a first cycle has finished.
					fading: time >= 1,
				};
			},
		);

		const fading = path.create({
			points: rings,
			closed,
			fill: "none",
			stroke: derive(state, (current) => current.previous),
			strokeWidth: derive(
				[width, state],
				(value, current) => value * (1 - current.fade),
			),
			visible: derive(
				[rawProp(ctx, "visible"), state],
				(visible, current) =>
					visible !== false && current.fading && current.fade < 1,
			),
		});
		const growing = path.create({
			points: derive([state, rings, backwards], (current, forward, back) =>
				current.back ? back : forward,
			),
			closed,
			fill: "none",
			stroke: derive(state, (current) => current.color),
			strokeWidth: width,
			progress: derive(state, (current) => current.drawn),
			visible: rawProp(ctx, "visible"),
		});
		forwardProps(ctx, fading, forwardedKeys);
		forwardProps(ctx, growing, forwardedKeys);
		return [fading, growing];
	},
	update: (changed, ctx) => {
		themes.get(ctx.node)?.set(ctx.theme);
		for (const child of ctx.node.children) forwardHandlers(changed, ctx, child);
		return undefined;
	},
});

/** Each boundary's theme source, made in `setup`. */
const themes = new WeakMap<object, Track<Theme>>();
