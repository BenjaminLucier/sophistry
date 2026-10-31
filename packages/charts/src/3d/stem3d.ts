/** A 3D stem plot: a drop line and a marker per point. */

import type { Line3DProps } from "@sophistry/3d";
import { dot3D, line3D } from "@sophistry/3d";
import type { CompositeContext, SceneNode } from "@sophistry/core";
import { defineComposite, Invalidate } from "@sophistry/core";
import type { Channel, ColorChannel } from "../data/channels";
import { numberValues, resolveColor } from "../data/channels";
import type { StemPoint3 } from "../math/3d/stem3d";
import { stemPoints3 } from "../math/3d/stem3d";
import type { AnyDatum } from "../props";
import {
	dataChanged,
	forwardAll,
	forwardChanged,
	forwardedEntries,
	setPoint3,
} from "./forward";

/** @category Plots */
export interface Stem3DProps<T = unknown>
	extends Omit<Line3DProps, "from" | "to" | "stroke" | "fill"> {
	/** One drop line and marker per datum. A datum with a non-finite coordinate is skipped. */
	data: readonly T[];
	/** World x, a key of `T` or `(d, i) => number`. */
	x: Channel<T, number>;
	/** World y (height; the drop line runs along y from `baseline` to this value), a key of `T` or `(d, i) => number`. */
	y: Channel<T, number>;
	/** World z, a key of `T` or `(d, i) => number`. A data channel, not the paint order: see `zIndex`. */
	z: Channel<T, number>;
	/** The y value each drop line starts from. @default 0 */
	baseline?: number;
	/** World-unit marker radius. @default 0.08 */
	markerRadius?: number;
	/** Colour of line and marker: one constant, or `(d, i) => colour` per stem. */
	color?: ColorChannel<T>;
}

const NO_DATA: readonly AnyDatum[] = [];

type Props = Stem3DProps<AnyDatum>;

/**
 * The props handed to every line and marker as they are (a marker takes
 * the ones `dot3D` has: `worldWidth` only reaches the lines).
 */
const forwarded = forwardedEntries(line3D.descriptor, [
	"from",
	"to",
	"stroke",
	"fill",
]);
const FORWARDED_KEYS = Object.keys(forwarded) as (keyof Props)[];
const FORWARDED = new Set<keyof Props>(FORWARDED_KEYS);

type LineNode = ReturnType<typeof line3D.create>;
type DotNode = ReturnType<typeof dot3D.create>;

/**
 * The lines and markers for the current data, reconciled by position (unkeyed), in
 * order: each stem's line, then its marker.
 */
function draw(ctx: CompositeContext<Props>): SceneNode[] {
	const props = ctx.props;
	const data = props.data ?? NO_DATA;
	const points = stemPoints3(
		numberValues(data, props.x),
		numberValues(data, props.y),
		numberValues(data, props.z),
		{ baseline: props.baseline },
	);
	const colorOf = resolveColor(props.color);
	const colorAt = (point: StemPoint3) =>
		colorOf?.(data[point.index], point.index);

	const placeLine = (line: LineNode, point: StemPoint3) => {
		line.set("stroke", colorAt(point));
		setPoint3(line, "from", point.drop[0]);
		setPoint3(line, "to", point.drop[1]);
	};
	const placeDot = (dot: DotNode, point: StemPoint3) => {
		dot.set("color", colorAt(point));
		setPoint3(dot, "center", point.marker);
		dot.set("radius", props.markerRadius);
	};

	const lines = ctx.list("lines", points, {
		key: (_point, index) => index,
		create: (point) => {
			const line = line3D.create({ to: point.drop[1] });
			forwardAll(props, line, FORWARDED_KEYS);
			placeLine(line, point);
			return line;
		},
		update: placeLine,
	});
	const dots = ctx.list("markers", points, {
		key: (_point, index) => index,
		create: (point) => {
			const dot = dot3D.create();
			forwardAll(props, dot, FORWARDED_KEYS);
			placeDot(dot, point);
			return dot;
		},
		update: placeDot,
	});

	const children: SceneNode[] = new Array(points.length * 2);
	for (let i = 0; i < points.length; i++) {
		children[2 * i] = lines[i];
		children[2 * i + 1] = dots[i];
	}
	return children;
}

/**
 * A 3D stem plot: a drop line along world y from `baseline` to `y`, plus a
 * marker, per point. Style props apply to lines and markers. Render under a
 * `camera3D`.
 *
 * @example
 * ```ts
 * import { camera3D } from "@sophistry/3d";
 * import { stem3D } from "@sophistry/charts/3d";
 *
 * const heights = [
 * 	{ x: -1, y: 1.5, z: 0 },
 * 	{ x: 1, y: 0.7, z: 1 },
 * ];
 * camera3D.create({
 * 	children: [stem3D.create({ data: heights, x: "x", y: "y", z: "z", color: "#4af" })],
 * });
 * ```
 *
 * @category Plots
 */
export const stem3D = defineComposite<Props>({
	name: "Stem3D",
	props: {
		...forwarded,
		data: { default: NO_DATA, invalidates: Invalidate.UPDATE },
		x: { invalidates: Invalidate.UPDATE },
		y: { invalidates: Invalidate.UPDATE },
		z: { invalidates: Invalidate.UPDATE },
		baseline: { default: 0, invalidates: Invalidate.UPDATE },
		markerRadius: { default: 0.08, invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => draw(ctx),
	update: (changed, ctx) => {
		forwardChanged(changed, ctx.props, ctx.node.children, FORWARDED);
		return dataChanged(changed, FORWARDED) ? draw(ctx) : undefined;
	},
});
