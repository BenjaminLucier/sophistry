/**
 * Shape matchers (Manim's `shape_matchers`): `surroundingRectangle`,
 * `backgroundRectangle`, `cross`, `underline`. Each wraps a `target`: a box
 * in scene units, or a scene node whose `bounds()` it follows. A missing
 * target draws nothing. Built where the box is.
 *
 * ## Following a node
 *
 * Given a node, a matcher subscribes to every value prop of that node
 * (`node.readable(key)` for each key of its descriptor) and re-reads its
 * `bounds()` when any of them is written or a bound source changes; the
 * subscriptions live only while the node is the target and the matcher is
 * not disposed. That covers the target being moved, resized, retexted or
 * restyled, which is what a scene does to the thing it highlights. It does
 * not see changes that reach the target from elsewhere: an enclosing group
 * moving, a composite's children changing, an async outline or a web font
 * arriving. For those, bind `target` to a `Readable<Bounds>` you invalidate
 * yourself (a `derive` over the sources that move it), which the matcher
 * follows like any bound prop.
 */

import type { ColorInput } from "../color/index.js";
import {
	boundsHeight,
	boundsWidth,
	centerOf,
	padBounds,
} from "../geometry/bounds.js";
import type { Bounds, Point, Polyline } from "../geometry/index.js";
import { polylineToCurvePath, rectPolyline } from "../geometry/index.js";
import { Invalidate } from "../scene/context.js";
import { definePrimitive } from "../scene/primitive.js";
import {
	type ShapeGeometry,
	type ShapeInstanceable,
	ShapeNode,
	type ShapeOptions,
	type ShapeProps,
	shapeProps,
} from "../scene/shape.js";
import type {
	DeclaredInstanceable,
	Definition,
	PropDescriptor,
	SceneNode,
} from "../scene/types.js";
import { DEFAULT_GAP } from "../spec/layout.js";
import { openRing } from "./rect.js";

/** No outline at all: the node takes part, and the renderer skips it. */
const NOTHING: ShapeGeometry = { polylines: [], closed: false };

/**
 * What a matcher wraps: a box in scene units, a node whose `bounds()` it
 * follows, or nothing (yet).
 *
 * @category Shapes
 */
export type MatcherTarget = Bounds | SceneNode | null | undefined;

/** Whether `target` is a scene node rather than a box. */
function isSceneNode(target: MatcherTarget): target is SceneNode {
	return (
		typeof target === "object" &&
		target !== null &&
		typeof (target as SceneNode).bounds === "function"
	);
}

/**
 * The box a target stands for: a box as given, a node's current `bounds()`
 * (null once it is disposed), or null.
 *
 * @param target - A box, a node, or nothing.
 * @returns The box in scene units, or null.
 *
 * @category Shapes
 */
export function targetBounds(target: MatcherTarget): Bounds | null {
	if (!target) return null;
	if (isSceneNode(target)) return target.disposed ? null : target.bounds();
	return target;
}

/** The target's box grown by `padding`, or null while the target is missing. */
function padded(
	target: MatcherTarget,
	padding: number | undefined,
): Bounds | null {
	const box = targetBounds(target);
	if (!box) return null;
	return padBounds(box, padding ?? DEFAULT_GAP);
}

/**
 * Props shared by everything that wraps a box.
 *
 * @category Shapes
 */
export interface MatcherProps extends ShapeProps {
	/**
	 * What to wrap: a box in scene units, or a node, whose `bounds()` the
	 * matcher follows (see the module notes for what it notices). `null` or
	 * `undefined` draws nothing, so scene code can create the matcher before
	 * its target exists.
	 */
	target: MatcherTarget;
	/** Padding on every side. Defaults to `DEFAULT_GAP`. */
	padding?: number;
}

/**
 * A shape node that follows a node `target`: a write to any of the target's
 * value props reruns the outline. With `pinned`, a prop left unset reads as
 * the pinned value (a background rectangle's `zIndex: -1`).
 */
class MatcherNode<P extends MatcherProps> extends ShapeNode<P> {
	private stopFollowing: (() => void) | null = null;
	private readonly pinned: Partial<P> | undefined;

	constructor(
		definition: Definition<P>,
		options: ShapeOptions<P>,
		pinned: Partial<P> | undefined,
	) {
		super(definition, options);
		this.pinned = pinned;
		if (pinned) Object.assign(this.props, pinned);
	}

	protected override propChanged<K extends keyof P>(
		key: K,
		descriptor: PropDescriptor<P[K]>,
	): void {
		const pinned = this.pinned;
		if (pinned && key in pinned && this.props[key] === undefined) {
			this.props[key] = pinned[key] as P[K];
		}
		if (key === "target") this.follow(this.props.target);
		super.propChanged(key, descriptor);
	}

	/** Subscribes to a node target's value props, dropping the previous target's. */
	private follow(target: MatcherTarget): void {
		this.stopFollowing?.();
		this.stopFollowing = null;
		if (!isSceneNode(target)) return;
		const stale = () => this.invalidate(Invalidate.GEOMETRY);
		const descriptor = target.definition.descriptor as Record<
			string,
			PropDescriptor<unknown>
		>;
		const followed = target as SceneNode<Record<string, unknown>>;
		const stops: (() => void)[] = [];
		for (const key of Object.keys(descriptor)) {
			if (descriptor[key]?.kind === "event") continue;
			stops.push(followed.readable(key).subscribe(stale));
		}
		stops.push(target.on("dispose", stale));
		this.stopFollowing = () => {
			for (const stop of stops) stop();
		};
	}

	protected override disposeContents(): void {
		this.stopFollowing?.();
		this.stopFollowing = null;
		super.disposeContents();
	}
}

/**
 * `defineShape` for a matcher: the same shape pipeline, on a node that
 * follows a node target.
 */
function defineMatcher<P extends MatcherProps, I extends keyof P = never>(
	options: ShapeOptions<P, I>,
	pinned?: Partial<P>,
): Definition<P, ShapeNode<P>, DeclaredInstanceable<P, I>> {
	return definePrimitive<P, ShapeNode<P>, I>({
		name: options.name,
		props: options.props,
		node: (definition) =>
			new MatcherNode<P>(definition, options as ShapeOptions<P>, pinned),
	});
}

/** Descriptor entries for the props every matcher takes. */
const matcherProps = {
	target: { invalidates: Invalidate.GEOMETRY },
	padding: { default: DEFAULT_GAP, invalidates: Invalidate.GEOMETRY },
} as const;

/** @category Shapes */
export interface SurroundingRectangleProps extends MatcherProps {
	/**
	 * Corner radius.
	 * @default 0
	 */
	cornerRadius?: number;
}

/** The padded box's rectangle, or nothing while the target is missing. */
function surroundingGeometry(
	props: Readonly<SurroundingRectangleProps>,
	padding: number | undefined,
): ShapeGeometry {
	const box = padded(props.target, padding);
	if (!box) return NOTHING;
	const ring = rectPolyline(
		box.minX,
		box.minY,
		boundsWidth(box),
		boundsHeight(box),
		props.cornerRadius ?? 0,
	);
	return {
		closed: true,
		curvePaths: [polylineToCurvePath(openRing(ring), true)],
	};
}

/**
 * A rectangle around `target`: Manim's `SurroundingRectangle`.
 *
 * The box is axis-aligned in the *scene's* units, because that is the space
 * `bounds()` reports in. Wrapping something inside a rotated `group`
 * therefore gives you its upright bounding box rather than a tilted frame,
 * which is the same answer Manim's `get_bounding_box` gives and usually the
 * one you want.
 *
 * @example
 * ```ts
 * import { createScene, text, surroundingRectangle } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const caption = scene.root.add(text.create({ text: "x = 1" }));
 * scene.root.add(surroundingRectangle.create({ target: caption })); // follows the label
 * ```
 *
 * @category Shapes
 */
export const surroundingRectangle = defineMatcher<
	SurroundingRectangleProps,
	ShapeInstanceable | "padding" | "cornerRadius"
>({
	name: "SurroundingRectangle",
	props: {
		...shapeProps,
		...matcherProps,
		padding: { ...matcherProps.padding, instanceable: true },
		cornerRadius: {
			default: 0,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
	},
	geometry: (props) => surroundingGeometry(props, props.padding),
});

/** @category Shapes */
export interface BackgroundRectangleProps extends SurroundingRectangleProps {
	/** Fill colour, used when `fill` is not given. Defaults to the theme background. */
	color?: ColorInput;
}

/**
 * The same box, filled with the theme background: Manim's
 * `BackgroundRectangle`. Put one behind a label that sits on top of a busy
 * plot and the text stays readable.
 *
 * **Z ordering is yours to keep right.** There is no depth relationship
 * between a matcher and its target: they are two independent nodes, painted
 * by `zIndex` and then by tree order. This one defaults to `zIndex: -1` so it
 * sits behind everything at the default depth, which covers the common case
 * of a plot drawn at `zIndex: 0`. If the thing you are covering has an
 * explicit `zIndex`, give the backdrop one just below it and give the label
 * one just above; sorting on paper beats hoping tree order holds.
 *
 * `padding` defaults to `0` here rather than `DEFAULT_GAP`, as in Manim: a
 * backdrop that grows past its text reads as a panel, not as a highlight.
 * It is drawn at 0.75 fill opacity with no outline unless you override those.
 *
 * @example
 * ```ts
 * import { backgroundRectangle, createScene, text } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const caption = scene.root.add(text.create({ text: "peak" }));
 * scene.root.add(backgroundRectangle.create({ target: caption }));
 * ```
 *
 * @category Shapes
 */
export const backgroundRectangle = defineMatcher<
	BackgroundRectangleProps,
	ShapeInstanceable | "padding" | "cornerRadius" | "color"
>(
	{
		name: "BackgroundRectangle",
		props: {
			...shapeProps,
			...matcherProps,
			padding: {
				default: 0,
				invalidates: Invalidate.GEOMETRY,
				instanceable: true,
			},
			cornerRadius: {
				default: 0,
				invalidates: Invalidate.GEOMETRY,
				instanceable: true,
			},
			color: { invalidates: Invalidate.STYLE, instanceable: true },
			fillOpacity: {
				default: 0.75,
				invalidates: Invalidate.STYLE,
				instanceable: true,
			},
			strokeWidth: {
				default: 0,
				invalidates: Invalidate.STYLE,
				instanceable: true,
			},
			zIndex: { default: -1, invalidates: Invalidate.SPEC },
		},
		geometry: (props) => surroundingGeometry(props, props.padding ?? 0),
		styleProps: (props, theme) => ({
			...props,
			fill: props.fill ?? props.color ?? theme.palette.background,
			fillOpacity: props.fillOpacity ?? 0.75,
			stroke: props.stroke ?? "none",
			strokeWidth: props.strokeWidth ?? 0,
		}),
	},
	{ zIndex: -1 },
);

/**
 * Props for {@link cross}. `scale` (from `ShapeProps`) grows the X about the
 * target box's centre, like Manim's `scale_factor`.
 *
 * @category Shapes
 */
export type CrossProps = MatcherProps;

/**
 * An X drawn across `target`: Manim's `Cross`, the "this one is wrong" mark.
 *
 * The two strokes are separate subpaths in one node, so a `draw()` reveal
 * draws one diagonal and then the other rather than both at once.
 *
 * `scale` is the ordinary `ShapeProps.scale`; the X's pivot defaults to the
 * centre of its box, which is the target's centre, so it grows in place.
 *
 * Unlike {@link surroundingRectangle}, `padding` defaults to 0 here.
 *
 * @example
 * ```ts
 * import { createScene, cross } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(cross.create({ target: { minX: -1, minY: -1, maxX: 1, maxY: 1 } }));
 * ```
 *
 * @category Shapes
 */
export const cross = defineMatcher<CrossProps, ShapeInstanceable | "padding">({
	name: "Cross",
	props: {
		...shapeProps,
		...matcherProps,
		padding: {
			default: 0,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
	},
	geometry: (props) => {
		const box = padded(props.target, props.padding ?? 0);
		if (!box) return NOTHING;
		const centre = centerOf(box);
		const halfWidth = boundsWidth(box) / 2;
		const halfHeight = boundsHeight(box) / 2;
		const first: Polyline = [
			{ x: centre.x - halfWidth, y: centre.y + halfHeight },
			{ x: centre.x + halfWidth, y: centre.y - halfHeight },
		];
		const second: Polyline = [
			{ x: centre.x - halfWidth, y: centre.y - halfHeight },
			{ x: centre.x + halfWidth, y: centre.y + halfHeight },
		];
		return {
			closed: false,
			curvePaths: [
				polylineToCurvePath(first, false),
				polylineToCurvePath(second, false),
			],
		};
	},
});

/** @category Shapes */
export interface UnderlineProps extends Omit<MatcherProps, "padding"> {
	/** Drop below the target's bottom edge. Defaults to `DEFAULT_GAP`. */
	gap?: number;
}

/**
 * A rule under `target`, as wide as it is: Manim's `Underline`.
 *
 * `gap` is the drop below the box's bottom edge only; the line spans the full
 * width. Underlining a `label` therefore tracks the text's *ink* box, since
 * that is what the metrics oracle measures, so a caption of lowercase letters
 * gets a rule that sits as close as it looks like it should.
 *
 * @example
 * ```ts
 * import { createScene, text, underline } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const word = scene.root.add(text.create({ text: "important" }));
 * scene.root.add(underline.create({ target: word }));
 * ```
 *
 * @category Shapes
 */
export const underline = defineMatcher<
	UnderlineProps,
	ShapeInstanceable | "gap"
>({
	name: "Underline",
	props: {
		...shapeProps,
		target: matcherProps.target,
		gap: {
			default: DEFAULT_GAP,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
	},
	geometry: (props) => {
		const box = targetBounds(props.target);
		if (!box) return NOTHING;
		const y = box.minY - (props.gap ?? DEFAULT_GAP);
		const start: Point = { x: box.minX, y };
		const end: Point = { x: box.maxX, y };
		return {
			closed: false,
			curvePaths: [polylineToCurvePath([start, end], false)],
		};
	},
});
