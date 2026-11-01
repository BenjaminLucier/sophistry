/** A structured-grid surface drawn as lines only: one polyline per grid row and column, as `line3D` segments. */

import type { Line3DProps } from "@sophistry/3d";
import { line3D } from "@sophistry/3d";
import type { CompositeContext, SceneNode } from "@sophistry/core";
import { defineComposite, Invalidate } from "@sophistry/core";
import type { Point3 } from "@sophistry/core/internal";
import { surfaceGridWireframe } from "../math/3d/surfaceGrid3d.js";
import {
	dataChanged,
	forwardAll,
	forwardChanged,
	forwardedEntries,
	setPoint3,
} from "./forward.js";

/** @category Primitives */
export interface Wireframe3DProps extends Omit<Line3DProps, "from" | "to"> {
	/** `nrows x ncols` grid of world x coordinates, `xs[row][col]`. All three grids must share a shape, or this throws. */
	xs: number[][];
	/** Grid of world y (height) coordinates, same shape as `xs`. */
	ys: number[][];
	/** Grid of world z coordinates, same shape as `xs`. */
	zs: number[][];
}

interface Segment {
	from: Point3;
	to: Point3;
}

/** Every polyline's consecutive pairs, flattened into one list of segments. */
function segmentsOf(lines: Point3[][]): Segment[] {
	const segments: Segment[] = [];
	for (const line of lines) {
		for (let i = 0; i < line.length - 1; i++) {
			segments.push({ from: line[i], to: line[i + 1] });
		}
	}
	return segments;
}

/** The props handed to every segment as they are. */
const forwarded = forwardedEntries(line3D.descriptor, ["from", "to"]);
const FORWARDED_KEYS = Object.keys(forwarded) as (keyof Wireframe3DProps)[];
const FORWARDED = new Set<keyof Wireframe3DProps>(FORWARDED_KEYS);

type LineNode = ReturnType<typeof line3D.create>;

const NO_GRID: number[][] = [];

function placeSegment(line: LineNode, segment: Segment): void {
	setPoint3(line, "from", segment.from);
	setPoint3(line, "to", segment.to);
}

/** The segments for the current grids, reconciled by position (unkeyed). */
function draw(ctx: CompositeContext<Wireframe3DProps>): SceneNode[] {
	const props = ctx.props;
	const segments = segmentsOf(
		surfaceGridWireframe(
			props.xs ?? NO_GRID,
			props.ys ?? NO_GRID,
			props.zs ?? NO_GRID,
		),
	);
	return ctx.list("segments", segments, {
		key: (_segment, index) => index,
		create: (segment) => {
			const line = line3D.create({ to: segment.to });
			forwardAll(props, line, FORWARDED_KEYS);
			placeSegment(line, segment);
			return line;
		},
		update: placeSegment,
	});
}

/**
 * A grid surface drawn as lines only: one polyline per grid row and column,
 * no fill. Takes {@link surfaceGrid3D}'s grids; style props apply to every
 * segment. Render under a `camera3D`.
 *
 * @example
 * ```ts
 * import { camera3D } from "@sophistry/3d";
 * import { wireframe3D } from "@sophistry/charts/3d";
 *
 * const xs = [[0, 1], [0, 1]];
 * const ys = [[0, 0.5], [0.5, 1]];
 * const zs = [[0, 0], [1, 1]];
 * camera3D.create({ children: [wireframe3D.create({ xs, ys, zs, stroke: "#4af" })] });
 * ```
 *
 * @category Primitives
 */
export const wireframe3D = defineComposite<Wireframe3DProps>({
	name: "Wireframe3D",
	props: {
		...forwarded,
		xs: { default: NO_GRID, invalidates: Invalidate.UPDATE },
		ys: { default: NO_GRID, invalidates: Invalidate.UPDATE },
		zs: { default: NO_GRID, invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => draw(ctx),
	update: (changed, ctx) => {
		forwardChanged(changed, ctx.props, ctx.node.children, FORWARDED);
		return dataChanged(changed, FORWARDED) ? draw(ctx) : undefined;
	},
});
