/**
 * `linearTransform`: applying a 2x2 matrix to space (Manim's
 * `LinearTransformationScene`). It is a `group` that accepts a shear: a linear
 * map takes lines to lines, so transforming vertices is exact, and interpolating
 * the matrix (`lerpMatrix`) is exact mid-animation too. Non-linear warps
 * (`applyFunction`, `homotopy`) need subdivision and live elsewhere.
 *
 * Like a group, it is a container whose one stage, `SPACE`, recomputes the
 * space it hands its children, keeps the same space object while nothing in
 * it changed, and tells its children only the fields that did change. Unlike
 * a group, it pins the pen scale (`Space.penScale`), so a shear moves points
 * and not ink.
 */

import type { ColorInput } from "../color/index.js";
import type { Matrix, Point } from "../geometry/index.js";
import {
	about,
	columnsOf,
	compose,
	determinant,
	fromColumns,
	IDENTITY,
	lerpMatrix,
	scaleFactorOf,
} from "../geometry/index.js";
import type { CompositeContext } from "../scene/composite.js";
import { defineComposite } from "../scene/composite.js";
import { BaseContainer } from "../scene/container.js";
import { Invalidate } from "../scene/context.js";
import { memo, ROOT_SPACE } from "../scene/node.js";
import { definePrimitive } from "../scene/primitive.js";
import { lastMatrix } from "../scene/shape.js";
import { text } from "../scene/text.js";
import type { InvalidateBits, SceneNode, Space } from "../scene/types.js";
import { SpaceChange } from "../scene/types.js";
import { vector } from "../shapes/line.js";

/**
 * Props for {@link linearTransform}. Give either `matrix` or `iHat`/`jHat`.
 *
 * @category Coordinate systems & graphs
 */
export interface LinearTransformProps {
	/**
	 * The map to apply. Build it with `linearMap([[a, b], [c, d]])` for
	 * blackboard notation, or `fromColumns(iHat, jHat)` for the basis-vector
	 * reading. Ignored when `iHat`/`jHat` are given.
	 */
	matrix?: Matrix;
	/** Where `î = (1,0)` lands. Shorthand for `fromColumns`. */
	iHat?: Point;
	/** Where `ĵ = (0,1)` lands. Shorthand for `fromColumns`. */
	jHat?: Point;
	/**
	 * Blend from the identity, 0..1. Defaults to 1 (fully applied).
	 *
	 * This is the animation handle, and deliberately a plain number rather than
	 * a bespoke animation: `valueTo(progress, 1, { duration: 2 })` *is* the warp,
	 * the same way `valueTo` on a camera's `units` is a zoom.
	 */
	progress?: number;
	/**
	 * The point the map holds fixed. Defaults to the origin — which is where a
	 * linear map fixes by definition, and where a lesson almost always wants it.
	 */
	origin?: Point;
	/**
	 * Let the map scale stroke widths too. Defaults to false.
	 *
	 * Off, the ink keeps the weight it had before the warp, which is what makes
	 * a stretched grid read as a stretched grid. On, outlines thicken and shear
	 * with the plane, as they would under a `group`'s `scale`.
	 */
	scaleStroke?: boolean;
	/** Multiplies into every descendant's opacity, as on `group`. */
	opacity?: number;
	/** The content to warp, in the same scene units as the surrounding space. */
	children?: readonly SceneNode[];
}

/** The map fields shared by the transform, the basis vectors and the determinant. */
type MapProps = Pick<LinearTransformProps, "matrix" | "iHat" | "jHat">;

/** Resolves the props into the fully-applied map, before `progress` blending. */
function targetMatrix(props: MapProps): Matrix {
	if (props.iHat || props.jHat) {
		return fromColumns(
			props.iHat ?? { x: 1, y: 0 },
			props.jHat ?? { x: 0, y: 1 },
		);
	}
	return props.matrix ?? IDENTITY;
}

/** The map blended from the identity by `progress`, about `origin`. */
function blendedMatrix(
	matrix: Matrix | undefined,
	iHat: Point | undefined,
	jHat: Point | undefined,
	progress: number | undefined,
	origin: Point | undefined,
): Matrix {
	const blended = lerpMatrix(
		IDENTITY,
		targetMatrix({ matrix, iHat, jHat }),
		progress ?? 1,
	);
	return origin ? about(blended, origin) : blended;
}

/**
 * A linear-transform node: a container that warps the space it hands its
 * children and pins their pen.
 *
 * @category Coordinate systems & graphs
 */
export class LinearTransformNode extends BaseContainer<LinearTransformProps> {
	/** The space handed to the children, current after the `SPACE` stage. */
	private ownSpace: Space = ROOT_SPACE;

	private readonly localOf = memo(blendedMatrix);
	private readonly matrixOf = lastMatrix();
	private readonly composed = memo((parent: Matrix, local: Matrix) =>
		compose(parent, local),
	);

	override get childSpace(): Space {
		return this.ownSpace;
	}

	protected override run(dirty: InvalidateBits): void {
		if (dirty & Invalidate.SPACE) this.recompute();
	}

	/** The parent's space changed: recompute ours rather than forwarding it. */
	override spaceChanged(_change: number): void {
		this.invalidate(Invalidate.SPACE);
	}

	/** Rebuilds the child space and tells the children what changed in it. */
	private recompute(): void {
		const parent = this.space;
		const props = this.props;
		const local = this.localOf(
			props.matrix,
			props.iHat,
			props.jHat,
			props.progress,
			props.origin,
		);
		const matrix = this.matrixOf(this.composed(parent.matrix, local));
		const opacity = parent.opacity * (props.opacity ?? 1);
		/**
		 * Pinned to the pre-map value, so the warp moves points and not ink. Read
		 * from the parent's own pin when there is one (nested transforms compose
		 * their geometry but must not compound their pen), and otherwise measured
		 * off the parent matrix — the answer a shape would have reached for
		 * anyway, frozen one level early.
		 */
		const penScale = props.scaleStroke
			? parent.penScale
			: (parent.penScale ?? scaleFactorOf(parent.matrix));
		// A warp of the plane moves what is drawn, not the window it is seen
		// through: an enclosing clip stays where it was stated.
		const clip = parent.clip;
		const yUp = parent.yUp;

		const previous = this.ownSpace;
		let change = 0;
		if (matrix !== previous.matrix) change |= SpaceChange.MATRIX;
		if (opacity !== previous.opacity) change |= SpaceChange.OPACITY;
		if (clip !== previous.clip) change |= SpaceChange.CLIP;
		if (penScale !== previous.penScale) change |= SpaceChange.PEN_SCALE;
		if (yUp !== previous.yUp) change |= SpaceChange.Y_UP;
		if (change === 0) return;
		this.ownSpace = {
			matrix,
			opacity,
			clip,
			penScale,
			yUp,
			lengthScale: parent.lengthScale,
		};
		for (const child of this.childNodes) child.spaceChanged(change);
	}
}

/**
 * Warps everything inside it by a linear map (the 3blue1brown staging: a faint
 * plane outside, a plane and shapes inside). `matrix` acts on scene
 * coordinates: its columns are where `(1, 0)` and `(0, 1)` land. `progress`
 * blends from the identity. Strokes keep their pre-map width unless
 * `scaleStroke` is set; a `group` inside still scales its own ink.
 *
 * @example
 * ```ts
 * import { createScene, linearTransform, numberPlane, track, valueTo } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const progress = track(0);
 * scene.add(
 * 	linearTransform.create({
 * 		iHat: { x: 1, y: 0 },
 * 		jHat: { x: 1, y: 1 },
 * 		progress,
 * 		children: [numberPlane.create({ xRange: [-4, 4, 1], yRange: [-3, 3, 1], width: 8, height: 6 })],
 * 	}),
 * );
 * scene.play(valueTo(progress, 1, { duration: 2 }));
 * ```
 *
 * @see {@link basisVectors}
 * @see {@link transformDeterminant}
 * @see {@link https://sophistry.dev/guides/coordinate-systems/}
 * @category Coordinate systems & graphs
 */
export const linearTransform = definePrimitive<
	LinearTransformProps,
	LinearTransformNode
>({
	name: "LinearTransform",
	container: true,
	props: {
		matrix: { invalidates: Invalidate.SPACE },
		iHat: { invalidates: Invalidate.SPACE },
		jHat: { invalidates: Invalidate.SPACE },
		progress: { default: 1, invalidates: Invalidate.SPACE },
		origin: { invalidates: Invalidate.SPACE },
		scaleStroke: { default: false, invalidates: Invalidate.SPACE },
		opacity: { default: 1, invalidates: Invalidate.SPACE },
		children: { kind: "children", invalidates: Invalidate.NONE },
	},
	node: (definition) => new LinearTransformNode(definition),
});

/**
 * Props for {@link basisVectors}. The map fields mirror {@link LinearTransformProps}.
 *
 * @category Coordinate systems & graphs
 */
export interface BasisVectorsProps {
	/** The map the arrows follow. Ignored when `iHat`/`jHat` are given. */
	matrix?: Matrix;
	/** Where `î = (1,0)` lands. */
	iHat?: Point;
	/** Where `ĵ = (0,1)` lands. */
	jHat?: Point;
	/** Blend from the identity, 0..1 — bind the same track as the transform's. */
	progress?: number;
	/** Tail of both arrows. Defaults to the origin. */
	origin?: Point;
	/**
	 * Draw `î` and `ĵ` beside the tips.
	 * @default false
	 */
	labels?: boolean;
	/**
	 * Text of the first label.
	 * @default "î"
	 */
	iLabel?: string;
	/**
	 * Text of the second label.
	 * @default "ĵ"
	 */
	jLabel?: string;
	/** Colour of the `î` arrow and label. Defaults to the first series colour. */
	iColor?: ColorInput;
	/** Colour of the `ĵ` arrow and label. Defaults to the second series colour. */
	jColor?: ColorInput;
	/** Arrow shaft width in scene units. */
	strokeWidth?: number;
	/** Arrow tip length in scene units. */
	tipLength?: number;
	/** Opacity, 0..1. */
	opacity?: number;
	/** Paint order; higher draws later. */
	zIndex?: number;
	/** Set to false to hide the arrows. */
	visible?: boolean;
}

/** Offset of a basis label from its arrow tip, in scene units. */
const LABEL_GAP = 0.28;

/** The arrows' and labels' props for the current map. */
function basisLayout(ctx: CompositeContext<BasisVectorsProps>) {
	const props = ctx.props;
	const series = ctx.theme.palette.series;
	const blended = lerpMatrix(
		IDENTITY,
		targetMatrix(props),
		props.progress ?? 1,
	);
	const origin = props.origin ?? { x: 0, y: 0 };
	const columns = columnsOf(blended);
	const tips = {
		iHat: { x: origin.x + columns.iHat.x, y: origin.y + columns.iHat.y },
		jHat: { x: origin.x + columns.jHat.x, y: origin.y + columns.jHat.y },
	};
	const iColor = props.iColor ?? (series[0] as string);
	const jColor = props.jColor ?? (series[1 % series.length] as string);

	const arrow = (to: Point, color: ColorInput) => ({
		from: origin,
		to,
		stroke: color,
		tipFill: color,
		strokeWidth: props.strokeWidth,
		tipLength: props.tipLength,
		opacity: props.opacity,
		zIndex: props.zIndex,
		visible: props.visible,
	});

	/** Nudged along the arrow so the label clears the tip whichever way it points. */
	const labelAt = (to: Point) => {
		const dx = to.x - origin.x;
		const dy = to.y - origin.y;
		const length = Math.hypot(dx, dy);
		if (length === 0) return to;
		return {
			x: to.x + (dx / length) * LABEL_GAP,
			y: to.y + (dy / length) * LABEL_GAP,
		};
	};
	const caption = (text: string, to: Point, color: ColorInput) => {
		const at = labelAt(to);
		return {
			text,
			x: at.x,
			y: at.y,
			color,
			align: "center" as const,
			baseline: "middle" as const,
			opacity: props.opacity,
			zIndex: props.zIndex,
			visible: props.visible,
		};
	};
	return {
		iArrow: arrow(tips.iHat, iColor),
		jArrow: arrow(tips.jHat, jColor),
		iCaption: caption(props.iLabel ?? "î", tips.iHat, iColor),
		jCaption: caption(props.jLabel ?? "ĵ", tips.jHat, jColor),
	};
}

/** The basis vectors' nodes: two arrows, then the two labels when asked for. */
interface BasisNodes {
	iArrow: SceneNode;
	jArrow: SceneNode;
	iCaption: SceneNode | null;
	jCaption: SceneNode | null;
}

const basisStates = new WeakMap<object, BasisNodes>();

function basisChildren(ctx: CompositeContext<BasisVectorsProps>): SceneNode[] {
	const next = basisLayout(ctx);
	let nodes = basisStates.get(ctx.node);
	if (!nodes) {
		nodes = {
			iArrow: vector.create(next.iArrow),
			jArrow: vector.create(next.jArrow),
			iCaption: null,
			jCaption: null,
		};
		basisStates.set(ctx.node, nodes);
	} else {
		nodes.iArrow.update(next.iArrow as never);
		nodes.jArrow.update(next.jArrow as never);
	}
	if (ctx.props.labels) {
		if (nodes.iCaption) nodes.iCaption.update(next.iCaption as never);
		else nodes.iCaption = text.create(next.iCaption);
		if (nodes.jCaption) nodes.jCaption.update(next.jCaption as never);
		else nodes.jCaption = text.create(next.jCaption);
		return [nodes.iArrow, nodes.jArrow, nodes.iCaption, nodes.jCaption];
	}
	nodes.iCaption?.dispose();
	nodes.jCaption?.dispose();
	nodes.iCaption = null;
	nodes.jCaption = null;
	return [nodes.iArrow, nodes.jArrow];
}

/**
 * The `î` and `ĵ` arrows, tracking the same map — the two vectors that a 2×2
 * *is*, and the ones a viewer follows to read what the matrix did.
 *
 * Deliberately drawn **outside** `linearTransform`, not inside it. An arrow
 * inside the warp has its head sheared along with its shaft, so it stops
 * looking like an arrow at exactly the moment it matters most; and its stroke
 * would need the same pen exemption twice over. Reading the columns of the
 * blended matrix instead gives an undistorted arrow that lands in precisely the
 * right place, because the columns of a matrix *are* the images of the basis
 * vectors — the same fact the component is there to teach.
 *
 * @example
 * ```ts
 * import { basisVectors, createScene, track } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const progress = track(0); // 0 shows the standard basis, 1 the transformed one
 * scene.add(basisVectors.create({ iHat: { x: 1, y: 0 }, jHat: { x: 1, y: 1 }, progress, labels: true }));
 * ```
 *
 * @category Coordinate systems & graphs
 */
export const basisVectors = defineComposite<BasisVectorsProps>({
	name: "BasisVectors",
	props: {
		matrix: { invalidates: Invalidate.UPDATE },
		iHat: { invalidates: Invalidate.UPDATE },
		jHat: { invalidates: Invalidate.UPDATE },
		progress: { default: 1, invalidates: Invalidate.UPDATE },
		origin: { invalidates: Invalidate.UPDATE },
		labels: { default: false, invalidates: Invalidate.UPDATE },
		iLabel: { default: "î", invalidates: Invalidate.UPDATE },
		jLabel: { default: "ĵ", invalidates: Invalidate.UPDATE },
		iColor: { invalidates: Invalidate.UPDATE },
		jColor: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		tipLength: { invalidates: Invalidate.UPDATE },
		opacity: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
	},
	setup: basisChildren,
	update: (_changed, ctx) => basisChildren(ctx),
});

/**
 * Signed area scale factor of the blended map — what the unit square's area
 * becomes at this point in the animation.
 *
 * Exposed because the determinant is usually the thing being *said* while the
 * grid moves, and a readout that derives it from the same blend the grid uses
 * can't drift out of step with what is on screen.
 *
 * @example
 * ```ts
 * import { transformDeterminant } from "@sophistry/core";
 *
 * transformDeterminant({ iHat: { x: 2, y: 0 }, jHat: { x: 0, y: 3 }, progress: 1 }); // 6
 * ```
 *
 * @param props - The same `matrix` / `iHat` / `jHat` / `progress` you pass to {@link linearTransform}.
 * @returns The determinant of the map blended from the identity by `progress` (1 at `progress = 0`).
 *
 * @category Coordinate systems & graphs
 */
export function transformDeterminant(props: {
	matrix?: Matrix;
	iHat?: Point;
	jHat?: Point;
	progress?: number;
}): number {
	return determinant(
		lerpMatrix(IDENTITY, targetMatrix(props), props.progress ?? 1),
	);
}
