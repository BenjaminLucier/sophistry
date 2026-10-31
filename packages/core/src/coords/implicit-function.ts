/**
 * `implicitFunction` — the curve `f(x, y) = 0` in **data** coordinates.
 *
 * A function graph is sampled along its input; an implicit curve has no input
 * to walk along, so it is found instead, by adaptive marching squares over the
 * plotting area (`implicitCurve` in the geometry entry). The search runs in
 * *scene* units and evaluates `function` through `pointToCoords`, so the grid is even on
 * screen and a log axis gets the same resolution at every decade instead of
 * all of it bunched at the top.
 */

import type { ImplicitCurveOptions, Range } from "../geometry";
import { implicitCurve, polylineToCurvePath } from "../geometry";
import { defineComposite } from "../scene/composite";
import { Invalidate } from "../scene/context";
import type { ShapeNode, ShapeProps } from "../scene/shape";
import { forwardHandlers, forwardProps } from "../shapes/forward";
import type { ShapeGeometry } from "../spec/bake";
import type { CoordinateSystem } from "./coords";
import { requireCoords } from "./coords";
import type { OutlineProps } from "./function-graph";
import {
	forwardedShapeProps,
	needsRebuild,
	onlyChild,
	outline,
	SHAPE_KEYS,
} from "./function-graph";

/**
 * Props for {@link implicitFunction}: the shape style props, the resolution
 * controls of {@link ImplicitCurveOptions}, and the function.
 *
 * @category Coordinate systems & graphs
 */
export interface ImplicitFunctionProps
	extends ShapeProps,
		ImplicitCurveOptions {
	/** The curve is where `f(x, y) = 0`, in data coordinates. `NaN`/`±Infinity` break it. */
	function: (x: number, y: number) => number;
	/** The x extent searched, in data units. Defaults to the axes' own `xRange`. */
	xRange?: Range;
	/** The y extent searched, in data units. Defaults to the axes' own `yRange`. */
	yRange?: Range;
}

/** Every connected piece of the curve, searched in scene units. */
function implicitOutline(
	props: Readonly<ImplicitFunctionProps>,
	coords: CoordinateSystem,
): ShapeGeometry {
	const xRange = props.xRange ?? coords.xRange();
	const yRange = props.yRange ?? coords.yRange();
	const low = coords.coordsToPoint(xRange[0], yRange[0]);
	const high = coords.coordsToPoint(xRange[1], yRange[1]);
	const pieces = implicitCurve(
		(u, v) => {
			const at = coords.pointToCoords({ x: u, y: v });
			return props.function(at.x, at.y);
		},
		[low.x, high.x],
		[low.y, high.y],
		{
			minDepth: props.minDepth,
			maxQuads: props.maxQuads,
			maxDepth: props.maxDepth,
		},
	);
	return {
		curvePaths: pieces.map(({ points, closed }) =>
			polylineToCurvePath(points, closed),
		),
		closed: false,
	};
}

/**
 * Draws `function(x, y) = 0` (Manim's `ImplicitFunction`) inside a coordinate
 * system, searched over its plotting area or `xRange`/`yRange` on an adaptive
 * grid (`minDepth`, `maxQuads`). Every connected piece is drawn; `progress`
 * reveals them in turn. Loops smaller than a starting cell, and zeros without a
 * sign change, are missed. A new `function`, range or coordinate system
 * searches again; style props do not.
 *
 * @example
 * ```ts
 * import { axes, createScene, implicitFunction } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const axesNode = scene.add(
 * 	axes.create({ xRange: [-3, 3, 1], yRange: [-2, 2, 1], width: 6, height: 4 }),
 * );
 * axesNode.add(implicitFunction.create({ function: (x, y) => x * x + y * y - 1 }));
 * ```
 *
 * @see {@link functionGraph}
 * @see {@link https://sophistry.dev/guides/coordinate-systems/#implicit-curves}
 * @category Coordinate systems & graphs
 */
export const implicitFunction = defineComposite<ImplicitFunctionProps>({
	name: "ImplicitFunction",
	props: {
		...forwardedShapeProps,
		function: { invalidates: Invalidate.UPDATE },
		xRange: { invalidates: Invalidate.UPDATE },
		yRange: { invalidates: Invalidate.UPDATE },
		minDepth: { default: 5, invalidates: Invalidate.UPDATE },
		maxQuads: { default: 1500, invalidates: Invalidate.UPDATE },
		maxDepth: { default: 12, invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => {
		const curve = outline.create({
			outline: implicitOutline(
				ctx.props,
				requireCoords(ctx, "ImplicitFunction"),
			),
		});
		forwardProps(ctx, curve, SHAPE_KEYS);
		return [curve];
	},
	update: (changed, ctx) => {
		const curve = onlyChild<ShapeNode<OutlineProps>>(ctx);
		forwardHandlers(changed, ctx, curve);
		if (needsRebuild(changed)) {
			curve.set(
				"outline",
				implicitOutline(ctx.props, requireCoords(ctx, "ImplicitFunction")),
			);
		}
		return undefined;
	},
});
