/**
 * `polarPlane`: rings for radius, spokes for angle (Manim's `PolarPlane`),
 * over an ordinary cartesian mapping.
 */

import type { ColorInput } from "../color/index.js";
import type { Point, Range } from "../geometry/index.js";
import {
	formatTick,
	polarPoint,
	TAU,
	tickStep,
	tickValues,
	wrapAngle,
} from "../geometry/index.js";
import type { CompositeContext } from "../scene/composite.js";
import { defineComposite } from "../scene/composite.js";
import { Invalidate } from "../scene/context.js";
import { measuresText } from "../scene/fonts.js";
import { text } from "../scene/text.js";
import type { SceneNode } from "../scene/types.js";
import { circle } from "../shapes/circle.js";
import { line } from "../shapes/line.js";
import { ORIGIN } from "../spec/layout.js";
import type { AxisOptions } from "./axes.js";
import { fullOptions } from "./axes.js";
import { anchoredLabelProps } from "./axis-labels.js";
import type { CoordinateSystem } from "./coords.js";
import {
	coordsOf,
	createCartesianCoords,
	createPhases,
	publishCoords,
} from "./coords.js";
import {
	DEFAULT_GRID_OPACITY,
	DEFAULT_GRID_STROKE_WIDTH,
	DEFAULT_GRID_Z_INDEX,
	sameRange,
	stablePoint,
	thin,
} from "./grid-lines.js";
import type { NumberLineProps } from "./number-line.js";
import { numberLine } from "./number-line.js";

// Every azimuth here is a fraction of `TAU`, one full turn, never of 360.

/** One spoke every 30°, the polar grid everyone has seen on paper. */
const DEFAULT_AZIMUTH_DIVISIONS = 12;
/** Half a degree per spoke. Past this a plane is a filled disc, not a grid. */
const MAX_AZIMUTH_DIVISIONS = 720;
/**
 * Rings wanted when neither `radiusStep` nor the caller says otherwise.
 *
 * Lower than the ten a linear axis defaults to: rings are concentric, so they
 * crowd towards the centre in a way ticks along a straight axis never do.
 */
const DEFAULT_RING_COUNT = 4;

/** `numberLine`'s reveal phases — line, ticks, numbers. */
const AXIS_PHASES = 3;
const DEFAULT_AZIMUTH_LABEL_FONT_SIZE = 0.28;
const DEFAULT_AZIMUTH_LABEL_GAP = 0.18;

/**
 * How the spokes are labelled — Manim's `azimuth_units`, minus the gradians
 * nobody has ever asked for.
 *
 * `"radians"` writes multiples of π rather than decimals, because π/6 is the
 * label and 0.5235987755982988 is the number underneath it.
 *
 * @category Coordinate systems & graphs
 */
export type AzimuthUnits = "none" | "degrees" | "radians";

/**
 * The coordinate system a {@link polarPlane} publishes. `coordsToPoint`/`pointToCoords` work
 * in Cartesian data coordinates (`xRange` and `yRange` are both
 * `[-maxRadius, maxRadius]`); the extra methods convert from polar.
 *
 * @category Coordinate systems & graphs
 */
export interface PolarCoordinateSystem extends CoordinateSystem {
	/** Polar data coordinates → scene units. `theta` is in **radians**. */
	polarToPoint(radius: number, theta: number): Point;
	/** Scene units → polar data coordinates. `theta` comes back in `[0, 2π)`. */
	pointToPolar(point: Point): { radius: number; theta: number };
}

/**
 * Props for {@link polarPlane}.
 *
 * @category Coordinate systems & graphs
 */
export interface PolarPlaneProps {
	/**
	 * Data radius at the outermost edge of the disc.
	 * @default 1
	 */
	maxRadius?: number;
	/** Data radius between consecutive rings. Defaults to a nice step. */
	radiusStep?: number;
	/** Scene-unit **diameter** of the disc — the `width`/`height` of a square plot. */
	size: number;
	/** Centre of the disc. Defaults to the scene origin. */
	center?: Point;
	/**
	 * Spokes around the full turn. The default is one every 30°.
	 * @default 12
	 */
	azimuthDivisions?: number;
	/**
	 * How spokes are labelled. Unlabelled by default: a plane is usually scenery.
	 * @default `"none"`
	 */
	azimuthUnits?: AzimuthUnits;
	/**
	 * Font size of azimuth labels.
	 * @default 0.28
	 */
	azimuthLabelFontSize?: number;
	/**
	 * Gap between the outermost ring and an azimuth label.
	 * @default 0.18
	 */
	azimuthLabelGap?: number;
	/**
	 * Overrides the generated azimuth text. Receives the angle in radians and
	 * the exact rational `numerator / denominator` of a *turn × 2* that produced
	 * it, so a caller can reuse `piMultipleLabel` rather than re-deriving the
	 * fraction from a float.
	 */
	formatAzimuth?: (
		theta: number,
		numerator: number,
		denominator: number,
	) => string;
	/**
	 * Draw the concentric rings.
	 * @default true
	 */
	rings?: boolean;
	/**
	 * Draw the spokes.
	 * @default true
	 */
	spokes?: boolean;
	/**
	 * The radial `numberLine` along θ = 0, which is where the radius ticks and
	 * numbers come from: `false` to leave it out, or its styling and tick
	 * options. Defaults to true.
	 */
	radialAxis?: boolean | AxisOptions;
	/** Colour of rings and spokes. Defaults to the theme's grid colour. */
	gridColor?: ColorInput;
	/**
	 * Width of rings and spokes.
	 * @default 0.02
	 */
	gridStrokeWidth?: number;
	/**
	 * Opacity of rings and spokes, 0..1.
	 * @default 0.45
	 */
	gridOpacity?: number;
	/**
	 * Paint order for the rings and spokes.
	 * @default -1
	 */
	gridZIndex?: number;
	/**
	 * Reveal amount, 0..1. The grid draws first, then the radial axis ticks and numbers, then azimuth labels.
	 * @default 1
	 */
	progress?: number;
	/** Paint order for the axis and labels; higher draws later. */
	zIndex?: number;
	/** Set to false to hide the plane. */
	visible?: boolean;
	/** Placed inside the coordinate context, so they can plot in data space. */
	children?: readonly SceneNode[];
}

/** Euclid, so that 6π/12 is written π/2 and 18π/12 is written 3π/2. */
function gcd(a: number, b: number): number {
	let x = Math.abs(Math.round(a));
	let y = Math.abs(Math.round(b));
	while (y > 0) {
		const remainder = x % y;
		x = y;
		y = remainder;
	}
	return x || 1;
}

/**
 * Formats `numerator × π / denominator` as reduced text (`π/6`, `2π/3`, `π`,
 * `2π`), for labelling angles in radians.
 *
 * @example
 * ```ts
 * import { piMultipleLabel } from "@sophistry/core";
 *
 * piMultipleLabel(6, 12); // "π/2"
 * ```
 *
 * @param numerator - Multiple of π in the numerator (rounded to an integer).
 * @param denominator - Denominator (rounded to an integer).
 * @returns The label, `"0"` for a zero numerator, or `""` if the denominator is zero or an input is not finite.
 *
 * @category Coordinate systems & graphs
 */
export function piMultipleLabel(
	numerator: number,
	denominator: number,
): string {
	if (
		!Number.isFinite(numerator) ||
		!Number.isFinite(denominator) ||
		Math.round(denominator) === 0
	) {
		return "";
	}
	const top = Math.abs(Math.round(numerator));
	const bottom = Math.abs(Math.round(denominator));
	if (top === 0) return "0";

	// The sign belongs on the front of the whole thing — "-π/2", not "π/-2".
	const sign = numerator * denominator < 0 ? "-" : "";
	const divisor = gcd(top, bottom);
	const reducedTop = top / divisor;
	const reducedBottom = bottom / divisor;
	const coefficient = reducedTop === 1 ? "" : String(reducedTop);
	return reducedBottom === 1
		? `${sign}${coefficient}π`
		: `${sign}${coefficient}π/${reducedBottom}`;
}

/**
 * The polar disc as a square Cartesian window, `[-maxRadius, maxRadius]` on
 * both axes, plus the polar conversions. Immutable.
 *
 * Composing rather than hand-rolling the mapping is what keeps a function
 * graph or a dot inside a polar plane working: `coordsToPoint` is the same
 * function it is inside `axes`, so `polarToPoint` is only ever a change of
 * variables on top of it and the two cannot drift apart.
 */
function polarCoords(
	maxRadius: number,
	size: number,
	centerX: number,
	centerY: number,
): PolarCoordinateSystem {
	const coords = createCartesianCoords({
		xRange: [-maxRadius, maxRadius],
		yRange: [-maxRadius, maxRadius],
		width: size,
		height: size,
		center: { x: centerX, y: centerY },
	});
	return Object.freeze({
		...coords,
		polarToPoint: (radius: number, theta: number) => {
			const at = polarPoint(0, 0, radius, theta);
			return coords.coordsToPoint(at.x, at.y);
		},
		pointToPolar: (point: Point) => {
			const { x, y } = coords.pointToCoords(point);
			return {
				radius: Math.hypot(x, y),
				theta: wrapAngle(Math.atan2(y, x)),
			};
		},
	});
}

/** What a polar plane keeps between updates. */
interface PolarPlaneState {
	coordsFor: typeof polarCoords;
	phase: ReturnType<typeof createPhases>;
	radialAxis: SceneNode<NumberLineProps> | null;
}

/** Per-node plane state. */
const states = new WeakMap<object, PolarPlaneState>();

function layout(ctx: CompositeContext<PolarPlaneProps>): SceneNode[] {
	let state = states.get(ctx.node);
	if (!state) {
		state = {
			coordsFor: ctx.memo(polarCoords),
			phase: createPhases(ctx.prop("progress"), AXIS_PHASES),
			radialAxis: null,
		};
		states.set(ctx.node, state);
	}
	const props = ctx.props;
	const theme = ctx.theme;

	const maxRadius = props.maxRadius ?? 1;
	const centre = props.center ?? ORIGIN;
	/** Scene-unit radius: half the diameter, and the disc's outer edge. */
	const sceneRadius = props.size / 2;
	const polar = state.coordsFor(maxRadius, props.size, centre.x, centre.y);
	publishCoords(ctx, polar);

	/** Shared by the rings and by the radial axis, so they cannot disagree. */
	const step = tickStep([0, maxRadius, props.radiusStep], {
		count: DEFAULT_RING_COUNT,
	});

	/**
	 * Ring radii, in data units. A zero-radius ring is a point rather than a
	 * circle, so the origin is dropped; the rest go through `thin` because a
	 * range and a step are two independent numbers and `radiusStep: 0.001` is
	 * one typo away from ten thousand `circle` nodes.
	 */
	const rings =
		props.rings !== false && maxRadius > 0
			? thin(tickValues([0, maxRadius], { step }).filter((value) => value > 0))
			: [];

	/**
	 * Clamped before anything is allocated. `thin` still caps what is *drawn*,
	 * but it has to be handed a list first, and `azimuthDivisions: 1e6` should
	 * not build a million-element array on the way to drawing 120 spokes.
	 */
	const asked = props.azimuthDivisions ?? DEFAULT_AZIMUTH_DIVISIONS;
	const divisions = Number.isFinite(asked)
		? Math.min(MAX_AZIMUTH_DIVISIONS, Math.max(1, Math.floor(asked)))
		: DEFAULT_AZIMUTH_DIVISIONS;

	/** Spoke indices rather than angles, so the π fraction stays exact. */
	const spokes = thin(Array.from({ length: divisions }, (_, index) => index));
	const thetaOf = (index: number) => (TAU * index) / divisions;

	/** Scene units per data unit of radius — the disc is uniform, so it's one number. */
	const scenePerData = maxRadius > 0 ? sceneRadius / maxRadius : 0;

	const azimuthText = (index: number): string => {
		const theta = thetaOf(index);
		// The generated angle is `index / divisions` of a turn, i.e.
		// `2·index / divisions` multiples of π — the exact rational the label wants.
		if (props.formatAzimuth)
			return props.formatAzimuth(theta, 2 * index, divisions);
		if (props.azimuthUnits === "degrees") {
			return `${formatTick((360 * index) / divisions)}°`;
		}
		return piMultipleLabel(2 * index, divisions);
	};

	/**
	 * The grid rides the axis's first phase, so it is complete by the time the
	 * ticks and numbers arrive — scenery, exactly as `numberPlane`'s is.
	 */
	const gridStyle = {
		stroke: props.gridColor ?? theme.palette.grid,
		strokeWidth: props.gridStrokeWidth ?? DEFAULT_GRID_STROKE_WIDTH,
		opacity: props.gridOpacity ?? DEFAULT_GRID_OPACITY,
		zIndex: props.gridZIndex ?? DEFAULT_GRID_Z_INDEX,
		visible: props.visible,
		progress: state.phase(0),
	};

	const ringNodes = ctx.list("rings", rings, {
		create: (value) =>
			circle.create({
				...gridStyle,
				center: centre,
				radius: value * scenePerData,
			}),
		update: (node, value) => {
			node.update({
				...gridStyle,
				center: stablePoint(node.get("center"), centre),
				radius: value * scenePerData,
			});
		},
	});

	const spokeNodes = ctx.list("spokes", props.spokes === false ? [] : spokes, {
		create: (index) =>
			line.create({
				...gridStyle,
				from: centre,
				to: polar.polarToPoint(maxRadius, thetaOf(index)),
			}),
		update: (node, index) => {
			node.update({
				...gridStyle,
				from: stablePoint(node.get("from"), centre),
				to: stablePoint(
					node.get("to"),
					polar.polarToPoint(maxRadius, thetaOf(index)),
				),
			});
		},
	});

	/**
	 * The radial axis is a `numberLine` lying along θ = 0, so radius ticks,
	 * numbers and their placement are the same code every other axis uses. Its
	 * range midpoint sits at its own centre, which is half way out along +x.
	 */
	const nodes: SceneNode[] = [...ringNodes, ...spokeNodes];
	if (props.radialAxis !== false) {
		const options = fullOptions({
			numbers: false,
			zIndex: props.zIndex,
			visible: props.visible,
			...(typeof props.radialAxis === "object" ? props.radialAxis : {}),
		});
		const current = state.radialAxis;
		const nextRange: Range = [0, maxRadius, step];
		const previousRange = current?.get("range");
		const axisProps = {
			...options,
			range:
				previousRange &&
				!("t" in previousRange) &&
				sameRange(previousRange as Range, nextRange)
					? previousRange
					: nextRange,
			length: sceneRadius,
			center: stablePoint(current?.get("center"), {
				x: centre.x + sceneRadius / 2,
				y: centre.y,
			}),
			progress: ctx.prop("progress"),
		};
		if (current) current.update(axisProps);
		else state.radialAxis = numberLine.create(axisProps);
		nodes.push(state.radialAxis as SceneNode);
	} else if (state.radialAxis) {
		state.radialAxis.dispose();
		state.radialAxis = null;
	}

	const labelled = (props.azimuthUnits ?? "none") !== "none";
	if (labelled) measuresText(ctx);
	const fontFamily = theme.defaults.fontFamily;
	const labelOptions = (index: number) => {
		const theta = thetaOf(index);
		return {
			text: azimuthText(index),
			at: polar.polarToPoint(maxRadius, theta),
			// Outward along the spoke, so a label never sits on the grid.
			direction: { x: Math.cos(theta), y: Math.sin(theta) },
			gap: props.azimuthLabelGap ?? DEFAULT_AZIMUTH_LABEL_GAP,
			fontSize: props.azimuthLabelFontSize ?? DEFAULT_AZIMUTH_LABEL_FONT_SIZE,
			color: theme.palette.foreground,
			zIndex: props.zIndex,
		};
	};
	const labelNodes = ctx.list("azimuths", labelled ? spokes : [], {
		create: (index) =>
			text.create({
				...anchoredLabelProps(labelOptions(index), fontFamily),
				progress: state.phase(2),
			}),
		update: (node, index) => {
			node.update({
				...anchoredLabelProps(
					labelOptions(index),
					fontFamily,
					node.get("place"),
				),
				progress: state.phase(2),
			});
		},
	});

	return [...nodes, ...labelNodes, ...ctx.children];
}

/**
 * A polar grid (Manim's `PolarPlane`): rings for radius, spokes for angle, over a
 * disc of diameter `size` with `maxRadius` at its edge. Underneath is an
 * ordinary cartesian mapping, so children plot in data space;
 * `polarCoordsOf(node)` adds `polarToPoint(radius, theta)` and `pointToPolar`.
 * Angles are radians; `azimuthUnits` only changes labels.
 *
 * @example
 * ```ts
 * import { createScene, polarCoordsOf, polarPlane } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const plane = scene.add(polarPlane.create({ size: 6, maxRadius: 3, azimuthUnits: "radians" }));
 * polarCoordsOf(plane)?.polarToPoint(1, Math.PI / 2); // { x: 0, y: 1 }
 * ```
 *
 * @see {@link https://sophistry.dev/guides/coordinate-systems/#polarplane-and-complexplane}
 * @category Coordinate systems & graphs
 */
export const polarPlane = defineComposite<PolarPlaneProps>({
	name: "PolarPlane",
	props: {
		maxRadius: { default: 1, invalidates: Invalidate.UPDATE },
		radiusStep: { invalidates: Invalidate.UPDATE },
		size: { invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		azimuthDivisions: {
			default: DEFAULT_AZIMUTH_DIVISIONS,
			invalidates: Invalidate.UPDATE,
		},
		azimuthUnits: { default: "none", invalidates: Invalidate.UPDATE },
		azimuthLabelFontSize: {
			default: DEFAULT_AZIMUTH_LABEL_FONT_SIZE,
			invalidates: Invalidate.UPDATE,
		},
		azimuthLabelGap: {
			default: DEFAULT_AZIMUTH_LABEL_GAP,
			invalidates: Invalidate.UPDATE,
		},
		formatAzimuth: { invalidates: Invalidate.UPDATE },
		rings: { default: true, invalidates: Invalidate.UPDATE },
		spokes: { default: true, invalidates: Invalidate.UPDATE },
		radialAxis: { default: true, invalidates: Invalidate.UPDATE },
		gridColor: { invalidates: Invalidate.UPDATE },
		gridStrokeWidth: {
			default: DEFAULT_GRID_STROKE_WIDTH,
			invalidates: Invalidate.UPDATE,
		},
		gridOpacity: {
			default: DEFAULT_GRID_OPACITY,
			invalidates: Invalidate.UPDATE,
		},
		gridZIndex: {
			default: DEFAULT_GRID_Z_INDEX,
			invalidates: Invalidate.UPDATE,
		},
		// The grid, the axis and the labels bind to the phases derived from it.
		progress: { default: 1, invalidates: Invalidate.NONE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
		children: { kind: "children", invalidates: Invalidate.NONE },
	},
	setup: layout,
	update: (_changed, ctx) => layout(ctx),
});

/**
 * {@link coordsOf} for a {@link polarPlane}: its system with
 * `polarToPoint`/`pointToPolar`.
 *
 * @param node - A polar plane.
 * @returns Its current system, or `null` for a node that publishes none.
 *
 * @category Coordinate systems & graphs
 */
export function polarCoordsOf(
	node: SceneNode<PolarPlaneProps>,
): PolarCoordinateSystem | null {
	return coordsOf(node) as PolarCoordinateSystem | null;
}
