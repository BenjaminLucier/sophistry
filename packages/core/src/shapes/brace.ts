/**
 * `brace`: a curly brace along one side of something, optionally labelled
 * at its tip. It is a composite of a filled shape plus, with a `label`, a
 * text node beside the tip: the brace
 * outline is a shape node bound to the composite's props, and the label is
 * made, placed and dropped by `update`.
 */

import type { ColorInput } from "../color";
import type { Bounds, Point } from "../geometry";
import { boundsFromCenter } from "../geometry/bounds";
import { braceRings, braceSpan, braceTip } from "../geometry/brace";
import { scaleFactorOf } from "../geometry/transform";
import { type CompositeContext, defineComposite } from "../scene/composite";
import { Invalidate } from "../scene/context";
import type { BaseNode } from "../scene/node";
import {
	defineShape,
	type ShapeInstanceable,
	type ShapeProps,
	shapeProps,
} from "../scene/shape";
import { label } from "../scene/text";
import type { PropsDescriptor, SceneNode } from "../scene/types";
import { DEFAULT_FONT_WEIGHT } from "../spec/bake";
import { nextTo, type Vec2 } from "../spec/layout";
import { labelBox, measureLabel } from "../spec/metrics";
import type { Theme } from "../themes/types";
import {
	forwardedProps,
	forwardHandlers,
	forwardProps,
	rawProp,
} from "./forward";

const DEFAULT_LABEL_FONT_SIZE = 0.32;
const DEFAULT_LABEL_GAP = 0.15;

/** The props that decide where the brace is: its span and its shape. */
interface BraceGeometryProps {
	/**
	 * The box to brace: a node's `bounds()`, say, as for the other matchers
	 * (`surroundingRectangle`, `underline`). The brace runs along the side
	 * facing `direction`. Ignored when `from` and `to` are given; `null` or
	 * `undefined` draws nothing.
	 */
	target?: Bounds | null;
	/**
	 * Which side of `target` to brace, as a vector (`DOWN`, `LEFT`, `UR`, ...). Defaults to `DOWN`.
	 */
	direction?: Point;
	/**
	 * Gap between `target` and the brace, scene units. Defaults to 0.2. With
	 * `from`/`to`, pushes the brace that far out from the span, toward its
	 * tip; defaults to 0 there.
	 */
	gap?: number;
	/**
	 * Or the span's two ends, in scene units (Manim's `BraceBetweenPoints`).
	 * The tip points to the right of the way from `from` to `to`: left to
	 * right points down; swap them to flip it.
	 */
	from?: Point;
	/** The other end of the span; see `from`. */
	to?: Point;
	/**
	 * How far the tip stands out from the span, scene units.
	 * @default 0.25
	 */
	depth?: number;
	/**
	 * Widest point of each arm, scene units.
	 * @default 0.08
	 */
	thickness?: number;
}

/** @category Shapes */
export interface BraceProps extends ShapeProps, BraceGeometryProps {
	/** Text beside the tip (Manim's `BraceLabel`/`BraceText`). */
	label?: string;
	/**
	 * Gap between the tip and the label.
	 * @default 0.15
	 */
	labelGap?: number;
	/**
	 * Label font size, scene units.
	 * @default 0.32
	 */
	labelFontSize?: number;
	/** Label colour. Defaults to the brace's fill. */
	labelColor?: string;
}

/**
 * The span a brace runs along: `from`/`to` pushed out by `gap`, or the side
 * of `target` facing `direction`; undefined with neither.
 */
function spanOf(
	props: Readonly<BraceGeometryProps>,
): { from: Point; to: Point } | undefined {
	if (props.from && props.to) {
		const { from, to } = props;
		const length = Math.hypot(to.x - from.x, to.y - from.y);
		const gap = props.gap ?? 0;
		if (!(length > 0) || gap === 0) return { from, to };
		// Out is the tip's side: clockwise of the way from `from` to `to`.
		const out = {
			x: ((to.y - from.y) / length) * gap,
			y: (-(to.x - from.x) / length) * gap,
		};
		return {
			from: { x: from.x + out.x, y: from.y + out.y },
			to: { x: to.x + out.x, y: to.y + out.y },
		};
	}
	if (!props.target) return undefined;
	return braceSpan(
		props.target,
		props.direction ?? { x: 0, y: -1 },
		props.gap ?? 0.2,
	);
}

/** The brace's fill: as given, else the theme foreground. */
function braceFill(props: Readonly<ShapeProps>, theme: Theme) {
	return props.fill ?? theme.palette.foreground;
}

/** The props of the brace outline: a shape with the span props. */
interface BraceOutlineProps extends ShapeProps, BraceGeometryProps {}

/** Descriptor entries for the span props: outline inputs. */
const braceGeometryProps = {
	target: { invalidates: Invalidate.GEOMETRY },
	direction: { invalidates: Invalidate.GEOMETRY },
	gap: { invalidates: Invalidate.GEOMETRY, instanceable: true },
	from: { invalidates: Invalidate.GEOMETRY, instanceable: true },
	to: { invalidates: Invalidate.GEOMETRY, instanceable: true },
	depth: {
		default: 0.25,
		invalidates: Invalidate.GEOMETRY,
		instanceable: true,
	},
	thickness: {
		default: 0.08,
		invalidates: Invalidate.GEOMETRY,
		instanceable: true,
	},
} as const;

/**
 * The brace's own shape: the two filled arm rings, built where they sit. A
 * filled shape: `fill` colours it (the theme's foreground by default) and
 * `stroke` is off unless set. What `brace` puts in its subtree.
 *
 * @internal
 */
export const braceOutline = defineShape<
	BraceOutlineProps,
	ShapeInstanceable | "gap" | "from" | "to" | "depth" | "thickness"
>({
	name: "BraceOutline",
	props: { ...shapeProps, ...braceGeometryProps },
	geometry: (props) => {
		const ends = spanOf(props);
		return {
			closed: true,
			polylines: ends
				? braceRings(ends.from, ends.to, {
						depth: props.depth,
						thickness: props.thickness,
					})
				: [],
		};
	},
	styleProps: (props, theme) => ({
		...props,
		fill: braceFill(props, theme),
		stroke: props.stroke ?? "none",
	}),
});

/** The outline props the composite binds its shape to. */
const forwarded = forwardedProps<BraceOutlineProps>(braceOutline.descriptor);
const forwardedKeys = Object.keys(forwarded) as (keyof BraceProps)[];

/** The forwarded props the label also reads: they rerun `update` as well. */
const labelInputs = [
	"target",
	"direction",
	"gap",
	"from",
	"to",
	"depth",
	"fill",
] as const;

const braceProps: PropsDescriptor<BraceProps> = {
	...forwarded,
	...Object.fromEntries(
		labelInputs.map((key) => [
			key,
			{ ...forwarded[key], invalidates: Invalidate.UPDATE },
		]),
	),
	label: { invalidates: Invalidate.UPDATE },
	labelGap: { default: DEFAULT_LABEL_GAP, invalidates: Invalidate.UPDATE },
	labelFontSize: {
		default: DEFAULT_LABEL_FONT_SIZE,
		invalidates: Invalidate.UPDATE,
	},
	labelColor: { invalidates: Invalidate.UPDATE },
} as PropsDescriptor<BraceProps>;

/**
 * The string whose ink sets a label's height beside the tip: digits, with
 * the cap height of names that start with a capital (as the axes' anchored
 * labels use).
 */
const LINE_REFERENCE = "0123456789";

/** Where the label sits beside the tip, and which way; undefined without a span. */
function tipOf(
	props: Readonly<BraceProps>,
): { at: Point; direction: Vec2 } | undefined {
	const ends = spanOf(props);
	if (!ends) return undefined;
	const length = Math.hypot(ends.to.x - ends.from.x, ends.to.y - ends.from.y);
	if (!(length > 0)) return undefined;
	return {
		at: braceTip(ends.from, ends.to, { depth: props.depth }),
		direction: {
			x: (ends.to.y - ends.from.y) / length,
			y: -(ends.to.x - ends.from.x) / length,
		},
	};
}

/**
 * The `place` that puts a label of `text` beside `at` in `direction`, `gap`
 * away (an axis's anchored label): the box is the string's own width but a
 * line height shared by every string at that font and size (the ink of
 * {@link LINE_REFERENCE}), so labels share a baseline. The string's box is
 * measured as `label` measures it, in the space's pixels and back to local
 * units.
 */
function besidePlace(
	text: string,
	at: Point,
	direction: Vec2,
	gap: number,
	fontSize: number,
	theme: Theme,
	node: BaseNode,
) {
	const space = node.space;
	const perUnit = scaleFactorOf(space.matrix) || 1;
	const fontFamily = theme.defaults.fontFamily;
	const measured = labelBox(
		text,
		{
			fontSize: fontSize * perUnit,
			fontFamily,
			fontWeight: DEFAULT_FONT_WEIGHT,
			italic: false,
			letterSpacing: 0,
			align: "center",
			baseline: "middle",
		},
		space.yUp,
	);
	const { ascent, descent } = measureLabel(LINE_REFERENCE, {
		fontSize,
		fontFamily,
		fontWeight: DEFAULT_FONT_WEIGHT,
		italic: false,
		letterSpacing: 0,
	});
	const halfLine = (ascent + descent) / 2;
	const middle = (measured.minY + measured.maxY) / 2 / perUnit;
	const box = {
		minX: measured.minX / perUnit,
		maxX: measured.maxX / perUnit,
		minY: middle - halfLine,
		maxY: middle + halfLine,
	};
	return nextTo(box, boundsFromCenter(at, 0, 0), direction, { gap });
}

/** The brace's children: its outline, and the label while it has one and a tip. */
function braceChildren(
	ctx: CompositeContext<BraceProps>,
	outline: SceneNode,
): readonly SceneNode[] {
	const props = ctx.props;
	const theme = ctx.theme;
	const tip = props.label !== undefined ? tipOf(props) : undefined;
	const labels = ctx.list("label", tip ? [tip] : [], {
		key: () => "label",
		create: () =>
			label.create({
				text: "",
				zIndex: rawProp(ctx, "zIndex"),
				opacity: rawProp(ctx, "opacity"),
				progress: rawProp(ctx, "progress"),
			}),
	});
	const text = labels[0];
	if (text && tip) {
		const fontSize = props.labelFontSize ?? DEFAULT_LABEL_FONT_SIZE;
		const content = props.label ?? "";
		const paint = braceFill(props, theme);
		text.update({
			text: content,
			fontSize,
			// The label follows a plain-colour fill; a gradient has no one colour to give it.
			color:
				props.labelColor ??
				(typeof paint === "string"
					? paint
					: (theme.palette.foreground as ColorInput)),
			place: besidePlace(
				content,
				tip.at,
				tip.direction,
				props.labelGap ?? DEFAULT_LABEL_GAP,
				fontSize,
				theme,
				ctx.node as unknown as BaseNode,
			),
		});
	}
	return text ? [outline, text] : [outline];
}

/**
 * `brace`: a curly brace along one side of something, optionally labelled at
 * its tip: Manim's `Brace`, `BraceBetweenPoints` and `BraceLabel` in one.
 *
 * Give it a `target` box (a node's `bounds()`, or a `unionBounds` of several)
 * and a `direction`, or the two ends of the span as `from`/`to`. The brace
 * keeps its depth and thickness whatever its length, as Manim's does, so a
 * brace under one letter and one under a whole equation look alike. It is a
 * filled shape: `fill` colours it (the theme's foreground by default) and
 * `stroke` is off unless set. `progress` reveals it like any shape and the
 * label follows. The pure geometry is `braceRings`, `braceTip` and
 * `braceSpan` in `@sophistry/core/geometry`.
 *
 * @example
 * ```ts
 * import { brace, createScene, DOWN } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(
 * 	brace.create({ target: { minX: -1, minY: -0.5, maxX: 1, maxY: 0.5 }, direction: DOWN, label: "2" }),
 * );
 * ```
 *
 * @category Shapes
 */
export const brace = defineComposite<BraceProps>({
	name: "Brace",
	props: braceProps,
	setup: (ctx) => {
		const outline = braceOutline.create();
		forwardProps(ctx, outline, forwardedKeys);
		return braceChildren(ctx, outline);
	},
	update: (changed, ctx) => {
		const outline = ctx.node.children[0] as SceneNode;
		forwardHandlers(changed, ctx, outline);
		return braceChildren(ctx, outline);
	},
});
