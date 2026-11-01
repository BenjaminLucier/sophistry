/**
 * Lines and arrows. A line's outline is its two endpoints in scene units
 * (no offset), so every arrow is one shape: the shaft and its
 * tips are subpaths of one outline, and a reveal draws the shaft first.
 */

import type { ColorInput } from "../color/index.js";
import type {
	CurvePath,
	Point,
	TipGeometry,
	TipShape,
} from "../geometry/index.js";
import {
	arcBetweenPointsCurvePath,
	arrowHeadAt,
	measureCurve,
	polylineToCurvePath,
	tangentAtT,
	tipIsClosed,
	tipPolylines,
} from "../geometry/index.js";
import { Invalidate } from "../scene/context.js";
import {
	defineShape,
	type ShapeGeometry,
	type ShapeInstanceable,
	type ShapeProps,
	shapeProps,
} from "../scene/shape.js";
import type { PropsDescriptor } from "../scene/types.js";
import type { PaintSpec } from "../spec/gradient.js";
import type { Theme } from "../themes/types.js";

/** @category Shapes */
export interface LineProps extends ShapeProps {
	/** Start point in scene units. */
	from: Point;
	/** End point in scene units. */
	to: Point;
}

/** Descriptor entries for a segment's two endpoints: outline inputs, per item. */
const endpointProps = {
	from: { invalidates: Invalidate.GEOMETRY, instanceable: true },
	to: { invalidates: Invalidate.GEOMETRY, instanceable: true },
} as const;

/** The straight outline from `from` to `to`, or nothing for a zero-length segment. */
function segmentGeometry(from: Point, to: Point): ShapeGeometry {
	// From a point to itself, nothing to draw: a zero-length stroke's round
	// caps would paint a dot (a drop line before it has length).
	return from.x === to.x && from.y === to.y
		? { polylines: [], closed: false }
		: {
				closed: false,
				curvePaths: [polylineToCurvePath([from, to], false)],
			};
}

/**
 * A straight segment from `from` to `to`, in scene units.
 *
 * It is an open shape, so `fill` has no effect. For arrowheads use
 * {@link arrow}; for a dashed look use {@link dashedLine} (or the `dash` prop
 * for a pattern you control).
 *
 * @example
 * ```ts
 * import { createScene, line } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const node = scene.root.add(line.create({ from: { x: -1, y: 0 }, to: { x: 1, y: 1 } }));
 * node.set("to", { x: 2, y: 0 });
 * ```
 *
 * @category Shapes
 */
export const line = defineShape<LineProps, ShapeInstanceable | "from" | "to">({
	name: "Line",
	props: { ...shapeProps, ...endpointProps },
	geometry: (props) => segmentGeometry(props.from, props.to),
});

/**
 * Props shared by everything that can grow a tip.
 *
 * @category Shapes
 */
export interface TippedProps {
	/** Tip outline. `"vee"` (the default) is the original two-stroke head. */
	tipShape?: TipShape;
	/**
	 * Which end carries the tip: `"end"` (at `to`, the default), `"start"` (at
	 * `from`), or `"both"`.
	 */
	tipAt?: "end" | "start" | "both";
	/**
	 * Tip extent.
	 * @default 0.28
	 */
	tipLength?: number;
	/** Colour for a closed tip. Defaults to the stroke, so it reads solid. */
	tipFill?: ColorInput;
}

/** The tip extent every arrow uses when `tipLength` is unset. */
export const DEFAULT_TIP_LENGTH = 0.28;

/**
 * One tip, aimed in `direction` (radians) at `tip`.
 *
 * `"vee"` goes through `arrowHeadAt` rather than the tip vocabulary so its
 * output is bit-identical to what `arrow` emitted before tips existed, and
 * so it keeps honouring `tipAngle`, which the shape-agnostic tips don't
 * take. Both branches only ever needed a bearing, never an actual tail
 * point: `arrowHeadAt`/`tipPolylines` are why this takes `direction` rather
 * than a `tail: Point` a caller would have to invent (`curvedArrow` has no
 * real tail point to offer; it has a tangent).
 *
 * @param shape - The tip outline.
 * @param tip - Where the tip's point sits, in scene units.
 * @param direction - The bearing it aims along, in radians.
 * @param length - The tip's extent.
 * @param spread - Half-angle of a `"vee"` tip, in radians; ignored otherwise.
 * @returns The tip's polylines and curve paths, and whether it is closed.
 *
 * @category Shapes
 */
export function tipGeometryAt(
	shape: TipShape,
	tip: Point,
	direction: number,
	length: number,
	spread?: number,
): TipGeometry {
	if (shape === "vee") {
		const vee = arrowHeadAt(tip, direction, length, spread);
		return {
			polylines: [vee],
			closed: false,
			curvePaths: [polylineToCurvePath(vee, false)],
		};
	}
	return tipPolylines(shape, tip, direction, length);
}

/**
 * Bearing from `tail` to `tip`, in radians: what a straight shaft's tip aims along.
 *
 * @category Shapes
 */
export function bearingTo(tail: Point, tip: Point): number {
	return Math.atan2(tip.y - tail.y, tip.x - tail.x);
}

/**
 * The paint a closed tip is filled with: `tipFill`, then `fill`, then the
 * stroke, then the theme foreground, so a triangle reads as solid without
 * every scene having to say so. Open tips keep `fill` as given: `fill` on an
 * unclosed shape is ignored by the renderer anyway.
 *
 * @param props - The tipped shape's paints.
 * @param closed - Whether the tip outline is closed.
 * @param theme - The active theme.
 * @returns The fill to bake.
 *
 * @category Shapes
 */
export function tipFillOf(
	props: Readonly<ShapeProps & TippedProps>,
	closed: boolean,
	theme: Theme,
): PaintSpec | undefined {
	if (!closed) return props.fill;
	return (
		props.tipFill ?? props.fill ?? props.stroke ?? theme.palette.foreground
	);
}

/** `props` with a closed tip's fill filled in (see {@link tipFillOf}). */
function withTipFill(
	props: Readonly<ShapeProps & TippedProps>,
	theme: Theme,
): Readonly<ShapeProps> {
	if (!tipIsClosed(props.tipShape ?? "vee")) return props;
	return { ...props, fill: tipFillOf(props, true, theme) };
}

/** @category Shapes */
export interface ArrowProps extends LineProps, TippedProps {
	/** Half-angle of a `"vee"` tip, in radians. Only used when `tipShape` is `"vee"`; otherwise the library default applies. */
	tipAngle?: number;
}

/** Where a tip sits on a shaft's end, and the outward bearing it aims along. */
interface ShaftEnd {
	point: Point;
	direction: number;
}

/** A shaft: its path, and its two ends as tips see them. */
interface Shaft {
	path: CurvePath;
	end(atStart: boolean): ShaftEnd;
}

/** A straight shaft from `from` to `to`. */
function straightShaft(from: Point, to: Point): Shaft {
	return {
		path: polylineToCurvePath([from, to], false),
		end: (atStart) =>
			atStart
				? { point: from, direction: bearingTo(to, from) }
				: { point: to, direction: bearingTo(from, to) },
	};
}

/**
 * Point and outward-facing bearing at one end of `curve`, from its exact
 * tangent (`tangentAtT`).
 *
 * `atStart` faces *backwards*, away from the curve's own direction of
 * travel: a tip at the tail of a shaft points off the far end, the same
 * convention `tipGeometryAt`'s straight-line callers use via `bearingTo`.
 *
 * @param curve - The shaft.
 * @param atStart - Which end.
 * @returns The end point and the bearing a tip there aims along.
 *
 * @category Shapes
 */
export function curveEndBearing(
	curve: CurvePath,
	atStart: boolean,
): { point: Point; direction: number } {
	const tangent = tangentAtT(measureCurve(curve), atStart ? 0 : 1);
	const direction = atStart
		? Math.atan2(-tangent.y, -tangent.x)
		: Math.atan2(tangent.y, tangent.x);
	const point = atStart
		? curve.start
		: (curve.segments[curve.segments.length - 1]?.to ?? curve.start);
	return { point, direction };
}

/** An `arcBetweenPoints` shaft, tips aligned to its tangent. */
function arcShaft(from: Point, to: Point, angle = Math.PI / 3): Shaft {
	const path = arcBetweenPointsCurvePath(from, to, angle);
	return { path, end: (atStart) => curveEndBearing(path, atStart) };
}

/**
 * The one arrow outline: `shaft` with a tip on `ends` (`"both"` adds the end
 * tip, then the start's). The shaft draws first and never fills
 * (`fillFrom: 1`), and a closed tip gets a fill (see `tipFillOf`). Every
 * arrow definition is a preset of this.
 */
function tippedShaft(
	props: Readonly<ArrowProps>,
	shaft: Shaft,
	ends: "start" | "end" | "both",
): ShapeGeometry {
	const shape = props.tipShape ?? "vee";
	const length = props.tipLength ?? DEFAULT_TIP_LENGTH;
	const tip = (atStart: boolean) => {
		const { point, direction } = shaft.end(atStart);
		return tipGeometryAt(shape, point, direction, length, props.tipAngle);
	};
	const heads =
		ends === "both" ? [tip(false), tip(true)] : [tip(ends === "start")];
	return {
		closed: (heads[0] as TipGeometry).closed,
		curvePaths: [shaft.path, ...heads.flatMap((head) => head.curvePaths)],
		// The shaft is structure, not area: see `ShapeGeometry.fillFrom`.
		fillFrom: 1,
	};
}

/** Descriptor entries for the tip props (`TippedProps` plus `tipAngle`). */
const tipProps = {
	// Closedness decides the default fill too, so it restyles as well.
	tipShape: {
		default: "vee",
		invalidates: Invalidate.GEOMETRY | Invalidate.STYLE,
	},
	tipAt: { default: "end", invalidates: Invalidate.GEOMETRY },
	tipLength: {
		default: DEFAULT_TIP_LENGTH,
		invalidates: Invalidate.GEOMETRY,
		instanceable: true,
	},
	tipFill: { invalidates: Invalidate.STYLE, instanceable: true },
	tipAngle: { invalidates: Invalidate.GEOMETRY, instanceable: true },
} as const;

/** The props an arrow lets `instances()` drive per item. */
type ArrowInstanceable =
	| ShapeInstanceable
	| "from"
	| "to"
	| "tipLength"
	| "tipFill"
	| "tipAngle";

/**
 * A line from `from` to `to` with a tip at the `to` end (see `tipAt`).
 *
 * Shaft and head are separate subpaths in one node, so a `draw()` reveal
 * draws the shaft first and the head last, as you'd draw it. Choose the head
 * outline with `tipShape`; closed tips are filled with `tipFill`, falling
 * back to `fill`, then the stroke colour.
 *
 * @example
 * ```ts
 * import { arrow, createScene } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(
 * 	arrow.create({ from: { x: 0, y: 0 }, to: { x: 2, y: 1 }, tipShape: "triangle" }),
 * );
 * ```
 *
 * @see {@link vector}
 * @see {@link doubleArrow}
 * @see {@link curvedArrow}
 *
 * @category Shapes
 */
export const arrow = defineShape<ArrowProps, ArrowInstanceable>({
	name: "Arrow",
	props: { ...shapeProps, ...endpointProps, ...tipProps },
	geometry: (props) =>
		tippedShaft(
			props,
			straightShaft(props.from, props.to),
			props.tipAt ?? "end",
		),
	styleProps: withTipFill,
});

/** @category Shapes */
export type DoubleArrowProps = Omit<ArrowProps, "tipAt">;

const { tipAt: _tipAt, ...tipPropsWithoutTipAt } = tipProps;

/**
 * An arrow pointing both ways: an {@link arrow} preset with `tipAt: "both"`.
 * The shaft still draws before either tip.
 *
 * @example
 * ```ts
 * import { createScene, doubleArrow } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(doubleArrow.create({ from: { x: -1, y: 0 }, to: { x: 1, y: 0 } }));
 * ```
 *
 * @see {@link arrow}
 *
 * @category Shapes
 */
export const doubleArrow = defineShape<DoubleArrowProps, ArrowInstanceable>({
	name: "DoubleArrow",
	props: { ...shapeProps, ...endpointProps, ...tipPropsWithoutTipAt },
	geometry: (props) =>
		tippedShaft(props, straightShaft(props.from, props.to), "both"),
	styleProps: withTipFill,
});

/** @category Shapes */
export interface VectorProps extends Omit<ArrowProps, "from"> {
	/** Tail of the vector. Defaults to the origin, which is the whole point. */
	from?: Point;
}

/**
 * An arrow from the origin to `to`: Manim's `Vector`.
 *
 * @example
 * ```ts
 * import { createScene, vector } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(vector.create({ to: { x: 1, y: 2 } }));
 * ```
 *
 * @category Shapes
 */
export const vector = defineShape<VectorProps, ArrowInstanceable>({
	name: "Vector",
	props: {
		...shapeProps,
		...endpointProps,
		from: {
			default: { x: 0, y: 0 },
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
		...tipProps,
	},
	geometry: (props) =>
		tippedShaft(
			props as ArrowProps,
			straightShaft(props.from ?? { x: 0, y: 0 }, props.to),
			props.tipAt ?? "end",
		),
	styleProps: withTipFill,
});

/** @category Shapes */
export interface CurvedArrowProps extends ArrowProps {
	/**
	 * Shaft turn in radians, as for `arcBetweenPoints`.
	 * @default Math.PI / 3
	 */
	angle?: number;
}

/** Descriptor entry for a curved shaft's turn. */
const angleProp = {
	angle: {
		default: Math.PI / 3,
		invalidates: Invalidate.GEOMETRY,
		instanceable: true,
	},
} as const;

/**
 * A circular arc from `from` to `to` with a tip on the end, aligned to the
 * shaft's tangent rather than its chord.
 *
 * The shaft is the same arc `arcBetweenPoints` draws; `angle` sets how far
 * it bows (positive and negative bow opposite ways).
 *
 * @example
 * ```ts
 * import { createScene, curvedArrow } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(
 * 	curvedArrow.create({ from: { x: -1, y: 0 }, to: { x: 1, y: 0 }, angle: Math.PI / 2 }),
 * );
 * ```
 *
 * @category Shapes
 */
export const curvedArrow = defineShape<
	CurvedArrowProps,
	ArrowInstanceable | "angle"
>({
	name: "CurvedArrow",
	props: { ...shapeProps, ...endpointProps, ...tipProps, ...angleProp },
	geometry: (props) =>
		tippedShaft(
			props,
			arcShaft(props.from, props.to, props.angle),
			props.tipAt ?? "end",
		),
	styleProps: withTipFill,
});

/** @category Shapes */
export type CurvedDoubleArrowProps = Omit<CurvedArrowProps, "tipAt">;

/**
 * A {@link curvedArrow} with a tip at both ends: a preset with `tipAt: "both"`.
 *
 * @example
 * ```ts
 * import { createScene, curvedDoubleArrow } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(curvedDoubleArrow.create({ from: { x: -1, y: 0 }, to: { x: 1, y: 0 } }));
 * ```
 *
 * @category Shapes
 */
export const curvedDoubleArrow = defineShape<
	CurvedDoubleArrowProps,
	ArrowInstanceable | "angle"
>({
	name: "CurvedDoubleArrow",
	props: {
		...shapeProps,
		...endpointProps,
		...tipPropsWithoutTipAt,
		...angleProp,
	},
	geometry: (props) =>
		tippedShaft(props, arcShaft(props.from, props.to, props.angle), "both"),
	styleProps: withTipFill,
});

/** @category Shapes */
export interface DashedLineProps extends LineProps {
	/** Fraction of the line covered by ink, as in Manim. Clamped to 0.01..0.99; defaults to 0.5. */
	dashRatio?: number;
	/** Dash count. Derived from `dashLength` and the line's own length if absent. */
	dashCount?: number;
	/**
	 * Target dash length, used only to choose `dashCount`.
	 * @default 0.16
	 */
	dashLength?: number;
}

/**
 * The dash pattern of a {@link dashedLine}: a whole number of dashes fitted
 * to the line, starting and ending on ink.
 *
 * @param props - The line's endpoints and dash props.
 * @returns `[ink, gap]` in scene units.
 *
 * @category Shapes
 */
export function dashedLinePattern(props: Readonly<DashedLineProps>): number[] {
	const length = Math.hypot(
		props.to.x - props.from.x,
		props.to.y - props.from.y,
	);
	const ratio = Math.min(0.99, Math.max(0.01, props.dashRatio ?? 0.5));
	const count = Math.max(
		1,
		Math.round(
			props.dashCount ?? length / ((props.dashLength ?? 0.16) / ratio),
		),
	);
	const ink = (length * ratio) / count;
	// The gaps sit *between* dashes, so there is one fewer of them: that is
	// what makes the line end on ink rather than trailing off mid-gap.
	const gap = count > 1 ? (length * (1 - ratio)) / (count - 1) : 0;
	return [ink, gap];
}

const dashedLineProps: PropsDescriptor<
	DashedLineProps,
	ShapeInstanceable | "from" | "to" | "dashRatio" | "dashCount" | "dashLength"
> = {
	...shapeProps,
	// The endpoints set the line's length, which the dash pattern is fitted to.
	from: {
		invalidates: Invalidate.GEOMETRY | Invalidate.STYLE,
		instanceable: true,
	},
	to: {
		invalidates: Invalidate.GEOMETRY | Invalidate.STYLE,
		instanceable: true,
	},
	lineCap: { default: "butt", invalidates: Invalidate.STYLE },
	dashRatio: {
		default: 0.5,
		invalidates: Invalidate.STYLE,
		instanceable: true,
	},
	dashCount: { invalidates: Invalidate.STYLE, instanceable: true },
	dashLength: {
		default: 0.16,
		invalidates: Invalidate.STYLE,
		instanceable: true,
	},
};

/**
 * Manim's `DashedLine`: a whole number of dashes fitted to the line, starting
 * and ending on ink.
 *
 * The generic `dash` style prop stays what it is: a raw canvas dash array you
 * control (here it is replaced by the fitted pattern). This one derives the
 * array from the line's own length, which is the bit you can't express with
 * a fixed pattern. `lineCap` defaults to `"butt"` here so dashes keep their
 * exact length.
 *
 * @example
 * ```ts
 * import { createScene, dashedLine } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(dashedLine.create({ from: { x: -2, y: 0 }, to: { x: 2, y: 0 }, dashCount: 8 }));
 * ```
 *
 * @category Shapes
 */
export const dashedLine = defineShape<
	DashedLineProps,
	ShapeInstanceable | "from" | "to" | "dashRatio" | "dashCount" | "dashLength"
>({
	name: "DashedLine",
	props: dashedLineProps,
	geometry: (props) => segmentGeometry(props.from, props.to),
	styleProps: (props) => ({
		...props,
		dash: dashedLinePattern(props),
		lineCap: props.lineCap ?? "butt",
	}),
});
