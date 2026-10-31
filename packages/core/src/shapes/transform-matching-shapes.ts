/**
 * `transformMatchingShapes`: the composite over `geometry/shape-match.ts`,
 * the shape counterpart of a math transform. One `path` per part, kept by
 * index across the run so the
 * reveal caches survive; transform props apply to a wrapping `group`.
 */

import type {
	MatchedShapePart,
	MatchShapesOptions,
	ShapePart,
} from "../geometry/shape-match";
import { morphShapes } from "../geometry/shape-match";
import { derive } from "../reactive";
import { type CompositeContext, defineComposite } from "../scene/composite";
import { Invalidate } from "../scene/context";
import { group } from "../scene/group";
import { type ShapeProps, shapeProps } from "../scene/shape";
import type { PropsDescriptor, SceneNode } from "../scene/types";
import type { PaintSpec } from "../spec/gradient";
import { rawProp } from "./forward";
import { path } from "./path";

/** @category Animation presets */
export interface TransformMatchingShapesProps
	extends Omit<
			ShapeProps,
			"progress" | "fill" | "stroke" | "strokeWidth" | "opacity"
		>,
		MatchShapesOptions {
	/** The starting group of shapes, as closed contours in scene units. */
	from: ShapePart[];
	/** The ending group of shapes. */
	to: ShapePart[];
	/**
	 * Morph blend: 0 is exactly `from`, 1 is exactly `to`. Defaults to 0.
	 * Named `blend`, not `progress`: `progress` is the arc-length reveal
	 * (default 1) of shapes, and this composite has no such reveal.
	 */
	blend?: number;
	/** Fill for every part; `partFill` overrides it per part. Defaults to the theme foreground. */
	fill?: PaintSpec;
	/** Outline for every part. Defaults to the part's fill colour. */
	stroke?: PaintSpec;
	/** Outline thickness. Defaults to the theme's stroke width. */
	strokeWidth?: number;
	/**
	 * Overall opacity 0..1 of the whole composite, on top of each part's own fade.
	 * @default 1
	 */
	opacity?: number;
	/** Colour a part by what the transform did to it: see `MatchedShapePart.role`. */
	partFill?: (part: MatchedShapePart, index: number) => PaintSpec | undefined;
}

/** The shape props the composite takes but does not use. */
const {
	progress: _progress,
	fill: _fill,
	stroke: _stroke,
	strokeWidth: _strokeWidth,
	opacity: _opacity,
	...unused
} = shapeProps;

/** Transform props, bound on the wrapping group. */
const groupKeys = ["place", "x", "y", "rotation", "scale", "origin"] as const;

const transformMatchingShapesProps: PropsDescriptor<TransformMatchingShapesProps> =
	{
		...Object.fromEntries(
			Object.entries(unused).map(([key, entry]) => [
				key,
				{ ...entry, invalidates: Invalidate.NONE, instanceable: false },
			]),
		),
		// The group follows these through bindings.
		...Object.fromEntries(
			groupKeys.map((key) => [
				key,
				{
					...shapeProps[key],
					invalidates: Invalidate.NONE,
					instanceable: false,
				},
			]),
		),
		opacity: { default: 1, invalidates: Invalidate.NONE },
		// The parts are resampled in `update`.
		from: { invalidates: Invalidate.UPDATE },
		to: { invalidates: Invalidate.UPDATE },
		maxCost: { invalidates: Invalidate.UPDATE },
		blend: { default: 0, invalidates: Invalidate.UPDATE },
		fill: { invalidates: Invalidate.UPDATE },
		stroke: { invalidates: Invalidate.UPDATE },
		strokeWidth: { invalidates: Invalidate.UPDATE },
		partFill: { invalidates: Invalidate.UPDATE },
		zIndex: { default: 0, invalidates: Invalidate.UPDATE },
		visible: { default: true, invalidates: Invalidate.UPDATE },
	} as PropsDescriptor<TransformMatchingShapesProps>;

type PathNode = ReturnType<typeof path.create>;

/** The part paths' props for the current blend. */
function partProps(
	ctx: CompositeContext<TransformMatchingShapesProps>,
	part: MatchedShapePart,
	index: number,
) {
	const props = ctx.props;
	const paint =
		props.partFill?.(part, index) ?? props.fill ?? ctx.theme.palette.foreground;
	return {
		points: part.polylines,
		closed: true,
		fill: paint,
		stroke: props.stroke ?? paint,
		strokeWidth: props.strokeWidth,
		opacity: part.opacity,
		zIndex: props.zIndex,
		visible: props.visible,
	};
}

/**
 * Morphs one group of shapes into another, pairing each source shape with the
 * target shape it most resembles: Manim's `TransformMatchingShapes`.
 *
 * Drive `blend` from 0 to 1 (for example bound to a `track` animated with
 * `valueTo`). Each shape in `from` pairs with whichever shape in `to` its
 * point cloud looks most like (translation/scale invariant, not rotation
 * invariant: see `geometry/shape-match.ts`'s module doc for where this
 * mis-pairs) and moves to it; whatever has no plausible match fades out or
 * in instead. Pass `maxCost` to refuse a poor match rather than forcing the
 * cheapest one available. The matching plan is rebuilt only when `from`,
 * `to` or `maxCost` change, never on `blend`.
 *
 * @example
 * ```ts
 * import { createScene, track, transformMatchingShapes, valueTo } from "@sophistry/core";
 * import { circlePolyline, rectPolyline } from "@sophistry/core/geometry";
 *
 * const before = [{ polylines: [circlePolyline(-2, 0, 1)] }, { polylines: [rectPolyline(1, -1, 2, 2)] }];
 * const after = [{ polylines: [rectPolyline(-3, -1, 2, 2)] }, { polylines: [circlePolyline(2, 0, 1)] }];
 *
 * const scene = createScene({ host: document.body });
 * const blend = track(0);
 * scene.root.add(transformMatchingShapes.create({ from: before, to: after, blend }));
 * scene.play(valueTo(blend, 1, { duration: 2 })); // the circle and square swap places
 * ```
 *
 * @category Animation presets
 */
export const transformMatchingShapes =
	defineComposite<TransformMatchingShapesProps>({
		name: "TransformMatchingShapes",
		props: transformMatchingShapesProps,
		setup: (ctx) => {
			const wrapper = group.create({
				place: rawProp(ctx, "place"),
				x: rawProp(ctx, "x"),
				y: rawProp(ctx, "y"),
				rotation: rawProp(ctx, "rotation"),
				scale: rawProp(ctx, "scale"),
				origin: rawProp(ctx, "origin"),
				opacity: derive(rawProp(ctx, "opacity"), (value) => value ?? 1),
			});
			const plan = ctx.memo(
				(from: ShapePart[], to: ShapePart[], maxCost: number | undefined) =>
					morphShapes(from, to, { maxCost }),
			);
			plans.set(ctx.node, plan);
			wrapper.setChildren(partNodes(ctx, plan));
			return [wrapper];
		},
		update: (_changed, ctx) => {
			const wrapper = ctx.node.children[0] as ReturnType<typeof group.create>;
			const plan = plans.get(ctx.node);
			if (plan) wrapper.setChildren(partNodes(ctx, plan));
			return undefined;
		},
	});

type Plan = (
	from: ShapePart[],
	to: ShapePart[],
	maxCost: number | undefined,
) => ReturnType<typeof morphShapes>;

/** Each composite's matching plan cache, made in `setup`. */
const plans = new WeakMap<object, Plan>();

/** One path per part at the current blend, kept by index. */
function partNodes(
	ctx: CompositeContext<TransformMatchingShapesProps>,
	plan: Plan,
): SceneNode[] {
	const props = ctx.props;
	const parts = plan(props.from, props.to, props.maxCost)(props.blend ?? 0);
	return ctx.list<MatchedShapePart, PathNode>("parts", parts, {
		key: (_part, index) => index,
		create: (part, index) => path.create(partProps(ctx, part, index)),
		update: (node, part, index) => {
			node.update(partProps(ctx, part, index));
		},
	});
}
