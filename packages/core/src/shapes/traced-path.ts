/**
 * `tracedPath`: the trail a moving point leaves. A composite around one
 * `path`: the trail is state
 * that grows with time, and time defaults to the clock in context, which a
 * shape's `geometry(props)` cannot read. So the path's `points` is bound to
 * a `derive` over the point, the time and the clock: the trail is extended
 * once per change, when the frame pulls it, and nothing runs while nothing
 * moves.
 */

import type { Point, Polyline } from "../geometry/index.js";
import type { Readable } from "../reactive/index.js";
import { derive } from "../reactive/index.js";
import { type CompositeContext, defineComposite } from "../scene/composite.js";
import { Invalidate } from "../scene/context.js";
import { type ShapeProps, shapeProps } from "../scene/shape.js";
import type { PropsDescriptor } from "../scene/types.js";
import type { Clock } from "../tween/clock.js";
import {
	forwardedProps,
	forwardHandlers,
	forwardProps,
	rawProp,
} from "./forward.js";
import { path } from "./path.js";

/** @category Shapes */
export interface TracedPathProps extends ShapeProps {
	/** The point to trace, in scene units: usually a moving track, bound. */
	point: Point;
	/**
	 * The time the point is at, in seconds. Defaults to the clock's time.
	 * Bind a timeline's time to make the trail scrub: seeking back shortens
	 * it to where the point had got to by then.
	 */
	time?: number;
	/**
	 * Keep only the last this many seconds of trail, so it fades out behind the point. Defaults to
	 * keeping all of it.
	 */
	dissipatingTime?: number;
	/**
	 * Skip a new point closer than this to the last one, scene units.
	 * @default 0.01
	 */
	minDistance?: number;
	/**
	 * Most points kept; the oldest go first.
	 * @default 5000
	 */
	maxPoints?: number;
}

const forwarded = forwardedProps<ShapeProps>(shapeProps);
const forwardedKeys = Object.keys(forwarded) as (keyof TracedPathProps)[];

const tracedPathProps: PropsDescriptor<TracedPathProps> = {
	...forwarded,
	// Read through the trail's `derive`: no `update` needed.
	point: { invalidates: Invalidate.NONE },
	time: { invalidates: Invalidate.NONE },
	dissipatingTime: { invalidates: Invalidate.NONE },
	minDistance: { default: 0.01, invalidates: Invalidate.NONE },
	maxPoints: { default: 5000, invalidates: Invalidate.NONE },
};

/**
 * The time a time-driven composite runs on: its `time` prop when set, else
 * the clock's. Follows both (a write to either marks it stale).
 *
 * @internal
 */
export function timeOf<P extends { time?: number }>(
	ctx: CompositeContext<P>,
	clock: Clock,
): Readable<number> {
	const time = rawProp(ctx, "time" as keyof P) as Readable<number | undefined>;
	return derive([time, clock.time], (own, now) => own ?? now);
}

/**
 * The trail as it stands after seeing `point` at `now`: cut back to `now`
 * if time ran backwards, extended by the point if it moved far enough,
 * trimmed to the last `dissipatingTime` seconds and `maxPoints` points.
 */
function traceTrail(): (
	point: Point,
	now: number,
	dissipatingTime: number | undefined,
	minDistance: number | undefined,
	maxPoints: number | undefined,
) => Polyline[] {
	let points: Polyline = [];
	let times: number[] = [];
	let polylines: Polyline[] = [points];
	return (point, now, dissipatingTime, minDistance, maxPoints) => {
		const keep = maxPoints ?? 5000;
		const gap = minDistance ?? 0.01;
		const before = points;

		// Time went back: drop what was traced after it.
		let end = times.length;
		while (end > 0 && (times[end - 1] as number) > now) end--;
		if (end < times.length) {
			points = points.slice(0, end);
			times = times.slice(0, end);
		}

		const last = points[points.length - 1];
		if (
			Number.isFinite(point.x) &&
			Number.isFinite(point.y) &&
			(!last || Math.hypot(point.x - last.x, point.y - last.y) >= gap)
		) {
			points = [...points, { x: point.x, y: point.y }];
			times = [...times, now];
		}

		let start = 0;
		if (dissipatingTime !== undefined) {
			const oldest = now - dissipatingTime;
			while (start < times.length && (times[start] as number) < oldest) start++;
		}
		start = Math.max(start, points.length - keep);
		if (start > 0) {
			points = points.slice(start);
			times = times.slice(start);
		}
		// The same array while the trail did not change, so the path keeps
		// its outline.
		if (points !== before) polylines = [points];
		return polylines;
	};
}

/**
 * `tracedPath`: the trail a moving point leaves, drawn as an open stroke.
 *
 * Bind the point (`point: dotCenter`) and it remembers where the point has
 * been, against time. That makes it consistent under scrubbing: when `time`
 * goes backwards (a timeline seeked back, or a replay starting again from 0)
 * the trail is cut back to what had been drawn by then instead of piling the
 * rewind on top. With `dissipatingTime` only the recent stretch is kept,
 * which is how Manim's `TracedPath(dissipating_time=…)` reads, though the
 * tail here is cut rather than faded.
 *
 * It traces what it is shown: points the point jumped past between frames
 * are not there, so a fast mover traces a coarser line. For the whole path
 * of a known motion, draw that path instead (`path` with `draw()`).
 *
 * @example
 * ```ts
 * import { createScene, tracedPath, track } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const position = track({ x: 0, y: 0 });
 * scene.root.add(tracedPath.create({ point: position, dissipatingTime: 1 }));
 * ```
 *
 * @category Shapes
 */
export const tracedPath = defineComposite<TracedPathProps>({
	name: "TracedPath",
	props: tracedPathProps,
	setup: (ctx) => {
		const clock = ctx.clock;
		// A dissipating trail ages even while nothing animates (a dragged
		// point), and a clock only ticks while something listens: hold it open.
		if (ctx.props.time === undefined && ctx.props.dissipatingTime !== undefined)
			ctx.onDispose(clock.onTick(() => {}));
		const trail = derive(
			[
				rawProp(ctx, "point"),
				timeOf(ctx, clock),
				rawProp(ctx, "dissipatingTime"),
				rawProp(ctx, "minDistance"),
				rawProp(ctx, "maxPoints"),
			],
			traceTrail(),
		);
		const stroke = path.create({ points: trail });
		forwardProps(ctx, stroke, forwardedKeys);
		return [stroke];
	},
	update: (changed, ctx) => {
		const [stroke] = ctx.node.children;
		if (stroke) forwardHandlers(changed, ctx, stroke);
		return undefined;
	},
});
