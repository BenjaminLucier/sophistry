/**
 * `complexPlane`: the complex plane (Manim's `ComplexPlane`), a
 * `numberPlane` speaking in `{ re, im }`.
 */

import type { Point } from "../geometry";
import { formatTick } from "../geometry";
import type { Complex } from "../geometry/complex";
import type { CompositeContext } from "../scene/composite";
import { defineComposite } from "../scene/composite";
import { Invalidate } from "../scene/context";
import type { SceneNode } from "../scene/types";
import type { AxisOptions } from "./axes";
import type { CoordinateSystem } from "./coords";
import { coordsOf, publishCoords } from "./coords";
import type { NumberPlaneProps, NumberPlaneState } from "./number-plane";
import {
	createNumberPlaneState,
	numberPlaneLayout,
	numberPlaneProps,
} from "./number-plane";

export type { Complex } from "../geometry/complex";

/**
 * The coordinate system a {@link complexPlane} publishes: `coordsToPoint`/`pointToCoords` plus complex-number conversions.
 *
 * @category Coordinate systems & graphs
 */
export interface ComplexCoordinateSystem extends CoordinateSystem {
	/** Complex number → scene units — Manim's `numberToPoint`. */
	numberToPoint(z: Complex): Point;
	/** Scene units → complex number — Manim's `pointToNumber`. */
	pointToNumber(point: Point): Complex;
}

/**
 * Props for {@link complexPlane}: the {@link NumberPlaneProps} with an imaginary axis.
 *
 * @category Coordinate systems & graphs
 */
export interface ComplexPlaneProps extends Omit<NumberPlaneProps, "yAxis"> {
	/** Overrides for the imaginary axis, merged over the `i` suffix default. */
	yAxis?: AxisOptions;
	/**
	 * Suffix the imaginary axis's numbers with `i`. Defaults to true — an
	 * unlabelled imaginary axis is indistinguishable from a real one.
	 */
	labelImaginaryUnit?: boolean;
}

/**
 * Formats an imaginary-axis tick number: `i`, `2i`, `-i`, `0`. This is the
 * default `tickFormat` of {@link complexPlane}'s y axis.
 *
 * The unit coefficient is dropped, because nobody writes `1i`, and the sign is
 * kept attached, because `-1i` is worse still. Zero stays plain — the origin is
 * a real number as much as an imaginary one.
 *
 * @example
 * ```ts
 * import { imaginaryTick } from "@sophistry/core";
 *
 * imaginaryTick(2); // "2i"
 * imaginaryTick(-1); // "-i"
 * ```
 *
 * @param value - The tick's raw value.
 * @param decimalPlaces - Fixed width of the number, as for `formatTick`.
 * @returns The plain number with an `i` suffix, with the unit coefficient dropped and zero left plain.
 *
 * @category Coordinate systems & graphs
 */
export function imaginaryTick(value: number, decimalPlaces?: number): string {
	const text = formatTick(value, decimalPlaces);
	if (value === 0) return text;
	if (text === "1") return "i";
	if (text === "-1") return "-i";
	return `${text}i`;
}

/**
 * Wraps the plane's own system rather than rebuilding one. `numberToPoint` is
 * exactly `coordsToPoint` with the pair renamed, which is the point: the two
 * can never drift, because there is only one mapping underneath.
 */
function extend(coords: CoordinateSystem): ComplexCoordinateSystem {
	return Object.freeze({
		...coords,
		numberToPoint: (z: Complex) => coords.coordsToPoint(z.re, z.im),
		pointToNumber: (point: Point) => {
			const { x, y } = coords.pointToCoords(point);
			return { re: x, im: y };
		},
	});
}

/** What a complex plane keeps between updates. */
interface ComplexPlaneState {
	plane: NumberPlaneState;
	extended: (coords: CoordinateSystem) => ComplexCoordinateSystem;
}

/** Per-node plane state. */
const states = new WeakMap<object, ComplexPlaneState>();

function layout(ctx: CompositeContext<ComplexPlaneProps>): SceneNode[] {
	let state = states.get(ctx.node);
	if (!state) {
		state = {
			plane: createNumberPlaneState(ctx),
			// One extension per system, so an unchanged mapping republishes nothing.
			extended: ctx.memo(extend),
		};
		states.set(ctx.node, state);
	}
	const props = ctx.props;
	const yAxis: AxisOptions = {
		tickFormat: props.labelImaginaryUnit === false ? undefined : imaginaryTick,
		...props.yAxis,
	};
	const { nodes, coords } = numberPlaneLayout(ctx, state.plane, {
		...props,
		yAxis,
	});
	publishCoords(ctx, state.extended(coords));
	return [...nodes, ...ctx.children];
}

/**
 * The complex plane — Manim's `ComplexPlane`: real on x, imaginary on y.
 *
 * Composed over `numberPlane`'s layout rather than forked from it, so the grid,
 * the axes, the tick arithmetic and the reveal phases are all literally the same
 * code. What it adds is a vocabulary: `numberToPoint`/`pointToNumber` speak in
 * `{ re, im }`, and the imaginary axis labels itself in units of `i`.
 *
 * Complex numbers are plain `{ re, im }` objects in data units. Read
 * `complexCoordsOf(node)` for `numberToPoint` and `pointToNumber`. Children are
 * placed in the plane's coordinate context, so `coordsToPoint(re, im)` and
 * function graphs work as they do in {@link axes}.
 *
 * @example
 * ```ts
 * import { complexCoordsOf, complexPlane, createScene } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const plane = scene.add(complexPlane.create({ xRange: [-3, 3, 1], yRange: [-2, 2, 1], width: 6, height: 4 }));
 * complexCoordsOf(plane)?.numberToPoint({ re: 1, im: 1 });
 * ```
 *
 * @category Coordinate systems & graphs
 */
export const complexPlane = defineComposite<ComplexPlaneProps>({
	name: "ComplexPlane",
	props: {
		...numberPlaneProps,
		labelImaginaryUnit: { default: true, invalidates: Invalidate.UPDATE },
	},
	setup: layout,
	update: (_changed, ctx) => layout(ctx),
});

/**
 * {@link coordsOf} for a {@link complexPlane}: its system with
 * `numberToPoint`/`pointToNumber`.
 *
 * @param node - A complex plane.
 * @returns Its current system, or `null` for a node that publishes none.
 *
 * @category Coordinate systems & graphs
 */
export function complexCoordsOf(
	node: SceneNode<ComplexPlaneProps>,
): ComplexCoordinateSystem | null {
	return coordsOf(node) as ComplexCoordinateSystem | null;
}
