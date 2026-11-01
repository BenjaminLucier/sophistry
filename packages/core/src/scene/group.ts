/**
 * `group`: transforms, dims and clips everything inside it.
 *
 * A group is a container whose only stage, `SPACE`, recomputes the space it
 * hands its children from its parent's space and its own props. It keeps the
 * same space object while nothing in it changed, and tells its children only
 * the fields that did change, so a write that changes nothing below costs
 * the group's own recompute and nothing more, and a field nobody below reads
 * (a shape ignores `yUp`) reruns nothing.
 */

import type { Point } from "../geometry/index.js";
import type { Matrix } from "../geometry/transform.js";
import {
	compose,
	fromTranslationRotationScale,
} from "../geometry/transform.js";
import type { ClipShape } from "../spec/clip.js";
import { nestClip } from "../spec/clip.js";
import type { Placement } from "../spec/layout.js";
import { readDelta } from "../spec/layout.js";
import { BaseContainer } from "./container.js";
import { Invalidate } from "./context.js";
import { memo, ROOT_SPACE } from "./node.js";
import { definePrimitive } from "./primitive.js";
import { lastMatrix } from "./shape.js";
import type { InvalidateBits, SceneNode, Space } from "./types.js";
import { SpaceChange } from "./types.js";

/** @category Shapes */
export interface GroupProps {
	/**
	 * Where a placement function put this group: the one prop a `Placement`
	 * fits. Adds to `x`/`y`. A group has no bounds of its own, so this is for
	 * moving a whole subtree by a delta measured from something inside it.
	 */
	place?: Placement;
	/**
	 * Horizontal translation of the whole subtree.
	 * @default 0
	 */
	x?: number;
	/**
	 * Vertical translation of the whole subtree.
	 * @default 0
	 */
	y?: number;
	/** Rotation about `origin` in radians; positive is counter-clockwise on a y-up stage. */
	rotation?: number;
	/**
	 * Uniform scale about `origin`. Strokes and text scale with it.
	 * @default 1
	 */
	scale?: number;
	/**
	 * Vertical scale about `origin`, overriding `scale` on the y axis only. Defaults to `scale`.
	 */
	scaleY?: number;
	/**
	 * Pivot for rotation and scale, in the group's own coordinates. Defaults to the origin (0, 0).
	 */
	origin?: Point;
	/**
	 * Multiplies into every descendant's opacity, 0..1.
	 * @default 1
	 */
	opacity?: number;
	/**
	 * Paint the subtree only inside this region: a box (`{ minX, minY, maxX,
	 * maxY }`), a polygon, or several rings (non-zero fill, so a ring wound
	 * the other way is a hole). Stated in the group's own units (the units
	 * its children are written in, after its `x`/`y`/`rotation`/`scale`), so
	 * the clip moves with the group. Nested clips intersect. Clipped-away
	 * parts are not hit either: a tap outside the region passes through.
	 * Bindable, so animating the region (a box widening across a plot) is a
	 * wipe. Omitted, nothing is clipped.
	 */
	clip?: ClipShape;
	/** The shapes and labels to transform. */
	children?: readonly SceneNode[];
}

/** Whether `m` leaves every point where it is. */
function isIdentity(m: Matrix): boolean {
	return (
		m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0
	);
}

/**
 * A group node: a container that recomputes the space it hands its children.
 *
 * @category Scene graph
 */
export class GroupNode extends BaseContainer<GroupProps> {
	/** The space handed to the children, current after the `SPACE` stage. */
	private ownSpace: Space = ROOT_SPACE;

	private readonly localOf = memo(
		(
			x: number | undefined,
			y: number | undefined,
			placeX: number,
			placeY: number,
			rotation: number | undefined,
			scale: number | undefined,
			scaleY: number | undefined,
			origin: Point | undefined,
		): Matrix =>
			fromTranslationRotationScale({
				x: (x ?? 0) + placeX,
				y: (y ?? 0) + placeY,
				rotation,
				scaleX: scale,
				scaleY: scaleY ?? scale,
				origin,
			}),
	);
	private readonly matrixOf = lastMatrix();
	private readonly composed = memo((parent: Matrix, local: Matrix) =>
		// A group that does not transform hands its parent's matrix on as is.
		isIdentity(local) ? parent : compose(parent, local),
	);
	// The parent's array when this group adds nothing, so every node under one
	// clipping group keeps sharing its region by identity (the renderer
	// installs a clip once per run of specs carrying the same list).
	private readonly clipOf = memo(nestClip);

	override get childSpace(): Space {
		return this.ownSpace;
	}

	protected override run(dirty: InvalidateBits): void {
		if (dirty & Invalidate.SPACE) this.recompute();
	}

	/**
	 * The parent's space changed: recompute ours (in this group's own refresh,
	 * on the same commit) rather than forwarding the change blindly.
	 */
	override spaceChanged(_change: number): void {
		this.invalidate(Invalidate.SPACE);
	}

	/** Rebuilds the child space and tells the children what changed in it. */
	private recompute(): void {
		const parent = this.space;
		const props = this.props;
		const delta = readDelta(props.place);
		const local = this.localOf(
			props.x,
			props.y,
			delta.x,
			delta.y,
			props.rotation,
			props.scale,
			props.scaleY,
			props.origin,
		);
		const matrix = this.matrixOf(this.composed(parent.matrix, local));
		const opacity = parent.opacity * (props.opacity ?? 1);
		const clip = this.clipOf(parent.clip, props.clip, matrix);
		// Only forwarded when an ancestor pinned it: otherwise stroke widths
		// keep coming off `matrix`, which is what a plain group has always done.
		// A group inside a `linearTransform` still scales its own ink, since
		// `scale` is a statement about size in a way a warp of the plane isn't.
		const penScale =
			parent.penScale === undefined
				? undefined
				: parent.penScale * (props.scale ?? 1);
		const yUp = parent.yUp;

		const previous = this.ownSpace;
		let change = 0;
		if (matrix !== previous.matrix) change |= SpaceChange.MATRIX;
		if (opacity !== previous.opacity) change |= SpaceChange.OPACITY;
		if (clip !== previous.clip) change |= SpaceChange.CLIP;
		if (penScale !== previous.penScale) change |= SpaceChange.PEN_SCALE;
		if (yUp !== previous.yUp) change |= SpaceChange.Y_UP;
		if (change === 0) return;
		this.ownSpace = { matrix, opacity, clip, penScale, yUp };
		for (const child of this.childNodes) child.spaceChanged(change);
	}
}

/**
 * Transforms, dims and clips everything inside it.
 *
 * Groups compose: transforms and opacities multiply down the tree, clips
 * intersect. Every prop is bindable, so animating a group's `rotation`,
 * `scale` or `opacity` moves a whole subtree at once while each child's
 * outline keeps its identity (a group's move is a new matrix for its
 * children). `zIndex` is not a group prop; give children their own.
 *
 * @example
 * ```ts
 * import { circle, createScene, group, rect } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const pair = group.create({
 * 	x: 2,
 * 	rotation: Math.PI / 6,
 * 	children: [circle.create({ radius: 1 }), rect.create({ width: 1, height: 1 })],
 * });
 * scene.root.add(pair);
 * pair.set("opacity", 0.5);
 * ```
 *
 * @category Shapes
 */
export const group = definePrimitive<GroupProps, GroupNode>({
	name: "Group",
	container: true,
	props: {
		place: { invalidates: Invalidate.SPACE },
		x: { default: 0, invalidates: Invalidate.SPACE },
		y: { default: 0, invalidates: Invalidate.SPACE },
		rotation: { default: 0, invalidates: Invalidate.SPACE },
		scale: { default: 1, invalidates: Invalidate.SPACE },
		scaleY: { invalidates: Invalidate.SPACE },
		origin: { invalidates: Invalidate.SPACE },
		opacity: { default: 1, invalidates: Invalidate.SPACE },
		clip: { invalidates: Invalidate.SPACE },
		children: { kind: "children", invalidates: Invalidate.NONE },
	},
	node: (definition) => new GroupNode(definition),
});
