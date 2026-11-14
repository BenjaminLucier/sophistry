/**
 * `axes3D` (Manim's `ThreeDAxes`, without a data coordinate system): three
 * `vector3D` arrows from a shared origin, with optional `line3D` ticks and
 * core `text` nodes at projected anchors.
 *
 * The arrows and ticks are ordinary 3D primitives: they re-project
 * themselves on a camera move and take part in the camera's depth sort. A
 * label is 2D text, so each sits in a small internal composite,
 * `AxisLabel3D`, that subscribes to the camera and, on a move, only
 * re-projects its anchor and writes `x`/`y`/`zIndex` (and `visible`, hiding
 * it while the anchor is behind the eye) to its one `text` child. The
 * `axes3D` composite itself reruns only when its own props or the theme
 * change.
 */

import {
	type CompositeContext,
	defineComposite,
	Invalidate,
	type SceneNode,
	text,
} from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import { formatTick, tickValues } from "@sophistry/core/geometry";
import type { Point3 } from "@sophistry/core/internal";
import { type Camera3DValue, camera3DContext } from "../context.js";
import { depthZ, projectPoint } from "../project.js";
import { line3D } from "./line3d.js";
import { vector3D } from "./vector3d.js";

/**
 * Tick-mark options for `Axes3DProps.ticks`; passing `true` takes every
 * default here.
 *
 * @category Primitives
 */
export interface Axis3DTickOptions {
	/**
	 * World-unit spacing between ticks, measured from the axis origin.
	 * @default 1
	 */
	step?: number;
	/**
	 * Tick mark length, in world units, centred on the axis.
	 * @default 0.15
	 */
	size?: number;
	/**
	 * Draw a number at each tick (the 2D axes' `numbers`).
	 * @default true
	 */
	numbers?: boolean;
}

/** @category Primitives */
export interface Axes3DProps {
	/**
	 * World-unit length of each axis arrow.
	 * @default 4
	 */
	length?: number;
	/**
	 * World-space origin the three axes share.
	 * @default `{ x: 0, y: 0, z: 0 }`
	 */
	origin?: Point3;
	/**
	 * Per-axis colour override (arrow, ticks and labels). Defaults to the
	 * theme's `axes` palette (a red/green/blue-ish triad).
	 */
	axisColors?: { x?: ColorInput; y?: ColorInput; z?: ColorInput };
	/**
	 * Draw the axis names ("x"/"y"/"z") past each tip. Tick numbers are
	 * `ticks.numbers`.
	 * @default true
	 */
	labels?: boolean;
	/**
	 * Shaft thickness, in world units, passed to each `vector3D`.
	 * @default 0.04
	 */
	worldWidth?: number;
	/**
	 * Tick marks (and, by default, numbers) at regular intervals along each
	 * axis: what turns "three arrows for orientation" into something a viewer
	 * can read a coordinate off, the way a 2D `numberLine` does. `false` (the
	 * default) draws plain arrows; `true` takes every
	 * {@link Axis3DTickOptions} default, or pass options to override
	 * `step`/`size`/`numbers`.
	 */
	ticks?: boolean | Axis3DTickOptions;
	/**
	 * Per-axis opacity multiplier (named like `axisColors`, since it is not a
	 * shape's single `opacity`), each defaulting to 1. Lets a scene fade one
	 * axis out independently of the others: e.g. the axis pointing straight
	 * at the camera in a near-overhead view foreshortens to a stub arrowhead
	 * on top of the origin, which reads as clutter once the other two already
	 * read as a flat plane. Fading that axis's opacity to 0 alongside whatever
	 * already drives "how flat does this scene read" (typically the same
	 * signal a `sphere3D`'s `shaded` reads) removes it without a discrete pop.
	 */
	axisOpacity?: { x?: number; y?: number; z?: number };
	/**
	 * Arc-length reveal, 0..1 (defaults to fully drawn), applied to every
	 * arrow and tick mark, so `draw()` on an `axes3D` draws the arrows in.
	 * Labels don't reveal: an axis label appearing once its arrow has
	 * finished drawing reads better than the glyphs themselves wiping in.
	 */
	progress?: number;
}

const DEFAULT_LENGTH = 4;
const DEFAULT_ORIGIN: Point3 = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_WORLD_WIDTH = 0.04;
const DEFAULT_TICK_STEP = 1;
const DEFAULT_TICK_SIZE = 0.15;
const TICK_LABEL_FONT_SIZE = 0.22;
/**
 * How far past the tick, along the same perpendicular used to draw it, its
 * number sits: clear of the tick mark itself.
 */
const TICK_LABEL_REACH = 0.35;
/**
 * How far past the tip a label sits, as a fraction of the axis length:
 * enough clearance that the glyph clears the arrowhead.
 */
const LABEL_REACH = 1.08;
const LABEL_FONT_SIZE = 0.34;

type Axis = "x" | "y" | "z";

const AXES: readonly Axis[] = ["x", "y", "z"];

function axisPoint(origin: Point3, axis: Axis, distance: number): Point3 {
	return {
		x: origin.x + (axis === "x" ? distance : 0),
		y: origin.y + (axis === "y" ? distance : 0),
		z: origin.z + (axis === "z" ? distance : 0),
	};
}

/**
 * Which way a tick mark crosses its axis: an arbitrary but consistent choice
 * per axis, since a tick "facing the camera" would need billboarding the
 * straight-segment primitives don't do. `x`'s ticks run vertically, `y`'s
 * and `z`'s horizontally.
 */
function perpendicular(axis: Axis): Point3 {
	return axis === "x" ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
}

/** `center + direction * distance`. */
function offsetPoint(
	center: Point3,
	direction: Point3,
	distance: number,
): Point3 {
	return {
		x: center.x + direction.x * distance,
		y: center.y + direction.y * distance,
		z: center.z + direction.z * distance,
	};
}

/**
 * Every tick's position, from one `step` out to (not past) `length`: the 2D
 * axes' `tickValues` over `[0, length]` (drift-free multiples of the step,
 * capped), less the origin, where the three arrows meet.
 */
function tickPositions(length: number, step: number): number[] {
	return tickValues([0, length], { step }).filter((value) => value > 0);
}

/* -------------------------------------------------------- AxisLabel3D */

/** @internal Props of one axis label. */
interface AxisLabel3DProps {
	/** The text. */
	text: string;
	/** World-space anchor. */
	at: Point3;
	/** Text colour. */
	color?: ColorInput;
	/** Font size, in scene units. */
	fontSize?: number;
	/** Opacity, 0..1. */
	opacity?: number;
}

/** What an `AxisLabel3D` keeps between its setup and its updates. */
interface AxisLabelState {
	text: SceneNode;
	camera: Camera3DValue | null;
	stopCamera: (() => void) | null;
}

const labelStates = new WeakMap<object, AxisLabelState>();

/** The camera above, (re)subscribing when it changed: a move reruns `update`. */
function connectCamera(
	ctx: CompositeContext<AxisLabel3DProps>,
	state: AxisLabelState,
): Camera3DValue {
	const camera = ctx.context(camera3DContext);
	if (camera === state.camera && camera) return camera;
	state.stopCamera?.();
	state.stopCamera = null;
	if (!camera) throw new Error("Axes3D must be inside a camera3D.");
	state.camera = camera;
	state.stopCamera = camera.subscribe(() => ctx.invalidate(camera3DContext));
	return camera;
}

/** Projects the anchor and moves the label there (hidden behind the eye). */
function placeLabel(
	ctx: CompositeContext<AxisLabel3DProps>,
	state: AxisLabelState,
): void {
	const projected = projectPoint(
		connectCamera(ctx, state),
		ctx.props.at ?? DEFAULT_ORIGIN,
	);
	const caption = state.text as ReturnType<typeof text.create>;
	if (!projected) {
		caption.set("visible", false);
		return;
	}
	caption.update({
		x: projected.x,
		y: projected.y,
		zIndex: depthZ(projected.depth),
		visible: true,
	});
}

/**
 * One axis label: a core `text` at its anchor's projection, painted at the
 * anchor's depth, hidden while the anchor is behind the eye. Text, colour,
 * size and opacity are bound to the label; only the anchor (and the camera)
 * rerun `update`.
 */
const axisLabel3D = defineComposite<AxisLabel3DProps>({
	name: "AxisLabel3D",
	props: {
		text: { default: "", invalidates: Invalidate.NONE },
		at: { default: DEFAULT_ORIGIN, invalidates: Invalidate.UPDATE },
		color: { invalidates: Invalidate.NONE },
		fontSize: { default: LABEL_FONT_SIZE, invalidates: Invalidate.NONE },
		opacity: { invalidates: Invalidate.NONE },
	},
	setup: (ctx) => {
		const state: AxisLabelState = {
			text: text.create({
				text: ctx.prop("text"),
				color: ctx.prop("color"),
				fontSize: ctx.prop("fontSize"),
				opacity: ctx.prop("opacity"),
			}),
			camera: null,
			stopCamera: null,
		};
		labelStates.set(ctx, state);
		ctx.onDispose(() => {
			state.stopCamera?.();
			state.stopCamera = null;
		});
		placeLabel(ctx, state);
		return [state.text];
	},
	update: (_changed, ctx) => {
		const state = labelStates.get(ctx);
		if (state) placeLabel(ctx, state);
		return undefined;
	},
});

/* ------------------------------------------------------------- Axes3D */

/** The tick options in effect, or `null` for no ticks. */
function tickOptions(ticks: Axes3DProps["ticks"]): Axis3DTickOptions | null {
	return ticks ? (ticks === true ? {} : ticks) : null;
}

/**
 * The axes' children, in document order: per axis, its arrow, then
 * each tick (mark, then number), then its name. Kept nodes are updated in
 * place; nodes for ticks that went away are disposed.
 */
function axesChildren(ctx: CompositeContext<Axes3DProps>): SceneNode[] {
	const props = ctx.props;
	// The theme's `axes` hues, not its `series`: every palette keeps x/y/z
	// recognisably red/green/blue so the mapping reads at a glance the way it
	// does in every other 3D tool.
	const palette = ctx.theme.palette.axes;
	const origin = props.origin ?? DEFAULT_ORIGIN;
	const length = props.length ?? DEFAULT_LENGTH;
	const worldWidth = props.worldWidth ?? DEFAULT_WORLD_WIDTH;
	const ticks = tickOptions(props.ticks);
	const labels = props.labels ?? true;
	const progress = ctx.prop("progress");
	const out: SceneNode[] = [];

	for (const axis of AXES) {
		const color = props.axisColors?.[axis] ?? palette[axis];
		const opacity = props.axisOpacity?.[axis] ?? 1;

		const arrow = {
			from: origin,
			to: axisPoint(origin, axis, length),
			stroke: color,
			worldWidth,
			opacity,
		};
		out.push(
			...ctx.list(`arrow-${axis}`, [axis], {
				create: () => vector3D.create({ ...arrow, progress }),
				update: (node) => node.update(arrow),
			}),
		);

		const positions = ticks
			? tickPositions(length, ticks.step ?? DEFAULT_TICK_STEP)
			: [];
		const size = ticks?.size ?? DEFAULT_TICK_SIZE;
		const half = size / 2;
		const perp = perpendicular(axis);
		const marks = ctx.list(`ticks-${axis}`, positions, {
			key: (_distance, index) => index,
			create: (distance) => line3D.create({ ...tickMark(distance), progress }),
			update: (node, distance) => node.update(tickMark(distance)),
		});
		const numbers = ctx.list(
			`numbers-${axis}`,
			ticks && (ticks.numbers ?? true) ? positions : [],
			{
				key: (_distance, index) => index,
				create: (distance) => axisLabel3D.create(tickNumber(distance)),
				update: (node, distance) => node.update(tickNumber(distance)),
			},
		);
		for (let i = 0; i < marks.length; i++) {
			out.push(marks[i]);
			if (numbers[i]) out.push(numbers[i]);
		}

		const name = {
			text: axis,
			at: axisPoint(origin, axis, length * LABEL_REACH),
			color,
			opacity,
		};
		out.push(
			...ctx.list(`name-${axis}`, labels ? [axis] : [], {
				create: () => axisLabel3D.create(name),
				update: (node) => node.update(name),
			}),
		);

		/** A tick's mark: a short segment across the axis, centred on it. */
		function tickMark(distance: number) {
			const center = axisPoint(origin, axis, distance);
			return {
				from: offsetPoint(center, perp, -half),
				to: offsetPoint(center, perp, half),
				stroke: color,
				worldWidth: size * 0.2,
				opacity,
			};
		}

		/** A tick's number, past the mark along the same perpendicular. */
		function tickNumber(distance: number) {
			const center = axisPoint(origin, axis, distance);
			return {
				text: formatTick(distance),
				at: offsetPoint(center, perp, half + TICK_LABEL_REACH),
				color,
				fontSize: TICK_LABEL_FONT_SIZE,
				opacity,
			};
		}
	}
	return out;
}

/**
 * Three arrows from a shared origin along the world x/y/z axes, optionally
 * labelled and ticked: the orientation cue every other 3D primitive is read
 * against.
 *
 * Colours come from the theme's `axes` palette (red/green/blue-ish for
 * x/y/z) unless overridden with `axisColors`. Pass `ticks` to mark and
 * number unit steps. `progress` reveals the arrows and ticks (so `draw()`
 * draws them in); labels are not revealed. Labels follow camera moves at the
 * cost of re-projecting their anchors. Must be inside a `camera3D`.
 *
 * @example
 * ```ts
 * import { createScene } from "@sophistry/core";
 * import { axes3D, camera3D } from "@sophistry/3d";
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 10 });
 * scene.add(camera3D.create({ children: [axes3D.create({ length: 3, ticks: true })] }));
 * ```
 *
 * @see {@link grid3D}
 * @category Primitives
 */
export const axes3D = defineComposite<Axes3DProps>({
	name: "Axes3D",
	props: {
		length: { default: DEFAULT_LENGTH, invalidates: Invalidate.UPDATE },
		origin: { default: DEFAULT_ORIGIN, invalidates: Invalidate.UPDATE },
		axisColors: { invalidates: Invalidate.UPDATE },
		labels: { default: true, invalidates: Invalidate.UPDATE },
		worldWidth: {
			default: DEFAULT_WORLD_WIDTH,
			invalidates: Invalidate.UPDATE,
		},
		ticks: { default: false, invalidates: Invalidate.UPDATE },
		axisOpacity: { invalidates: Invalidate.UPDATE },
		// Bound to the arrows and ticks: no update.
		progress: { invalidates: Invalidate.NONE },
	},
	setup: (ctx) => {
		// Only meaningful under a camera, like every other 3D primitive, even
		// though the children do the projecting.
		if (!ctx.context(camera3DContext)) {
			throw new Error("Axes3D must be inside a camera3D.");
		}
		return axesChildren(ctx);
	},
	update: (_changed, ctx) => axesChildren(ctx),
});
