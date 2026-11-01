/**
 * `symbolMarker`: the shape a scatter's markers are instances of. Internal
 * (not in the family barrel, so no binding is generated for it).
 *
 * An instances node of this shape covers every symbol at once, and the
 * core picks the cheapest spec for what the items hold:
 *
 * - every item a circle: `circle` marks (the renderer's splat path), the
 *   same spec `instances(circle, ...)` publishes;
 * - one other symbol and one radius: one shared `outline`, placed per item;
 * - mixed symbols or radii: a `paths` mark (one outline per distinct
 *   symbol and radius, cached by the instances node).
 *
 * The radius is a geometry input rather than a `scale`, so a marker's
 * outline stroke keeps its width at any size.
 */

import type { ShapeInstanceable, ShapeProps } from "@sophistry/core";
import { defineShape, Invalidate, shapeProps } from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import { arcCurvePath, polylineToCurvePath } from "@sophistry/core/geometry";
import type { SymbolName } from "../math/symbol.js";
import { symbolPolygon } from "../math/symbol.js";

/** Props of {@link symbolMarker}. */
export interface SymbolMarkerProps extends ShapeProps {
	/** Centre, in scene units. */
	center?: Point;
	/** The radius of the circle whose area the symbol has. */
	radius?: number;
	/** The symbol. @default "circle" */
	symbol?: SymbolName;
}

/**
 * A scatter marker: a circle, or a symbol with the area of a circle of
 * `radius`, centred on `center`.
 */
export const symbolMarker = defineShape<
	SymbolMarkerProps,
	ShapeInstanceable | "center" | "radius" | "symbol"
>({
	name: "SymbolMarker",
	props: {
		...shapeProps,
		center: { invalidates: Invalidate.TRANSFORM, instanceable: true },
		radius: {
			default: 0,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
		symbol: {
			default: "circle",
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
	},
	geometry: (props) => {
		const radius = props.radius ?? 0;
		const symbol = props.symbol ?? "circle";
		if (symbol === "circle") {
			return {
				closed: true,
				curvePaths: [
					{ ...arcCurvePath(0, 0, radius, 0, Math.PI * 2), closed: true },
				],
			};
		}
		return {
			closed: true,
			curvePaths: [
				polylineToCurvePath(symbolPolygon(symbol, 0, 0, radius), true),
			],
		};
	},
	offset: (props) => props.center,
	instanceMark: (props) =>
		(props.symbol ?? "circle") === "circle"
			? { kind: "circle", radius: props.radius ?? 0 }
			: null,
});
