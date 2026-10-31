/**
 * Dots: small filled discs that mark a point (`dot`, `annotationDot`), and
 * `labeledDot`, a disc with its text, which is a composite of a disc and
 * a label. The disc is a circle placed by its `center` (the shape's `offset`).
 */

import type { ColorInput } from "../color";
import type { Point } from "../geometry";
import { arcCurvePath } from "../geometry";
import { boundsHeight, boundsWidth } from "../geometry/bounds";
import { scaleFactorOf } from "../geometry/transform";
import { type CompositeContext, defineComposite } from "../scene/composite";
import { Invalidate } from "../scene/context";
import {
	defineShape,
	type ShapeGeometry,
	type ShapeInstanceable,
	type ShapeProps,
	shapeProps,
} from "../scene/shape";
import { label } from "../scene/text";
import type { PropsDescriptor } from "../scene/types";
import { SpaceChange } from "../scene/types";
import { DEFAULT_FONT_WEIGHT } from "../spec/bake";
import { labelBox } from "../spec/metrics";
import type { Theme } from "../themes/types";
import {
	forwardedProps,
	forwardHandlers,
	forwardProps,
	rawProp,
} from "./forward";

/** @category Shapes */
export interface DotProps extends Omit<ShapeProps, "fill"> {
	/** Centre. Defaults to the origin. */
	center?: Point;
	/**
	 * Radius.
	 * @default 0.09
	 */
	radius?: number;
	/** Fill colour (and the default stroke colour). Defaults to the theme accent. */
	color?: ColorInput;
}

/** Manim's `DEFAULT_DOT_RADIUS`, in our units. */
const DOT_RADIUS = 0.09;

/** A full circle of `radius` about the origin, as `circle` builds it. */
function discGeometry(radius: number): ShapeGeometry {
	return {
		closed: true,
		curvePaths: [
			{ ...arcCurvePath(0, 0, radius, 0, Math.PI * 2), closed: true },
		],
	};
}

/** A dot's paints: `color` fills it and strokes it unless `stroke` says otherwise; no ring by default. */
function dotStyle(props: Readonly<DotProps>, theme: Theme): ShapeProps {
	const color = props.color ?? theme.palette.accent;
	return {
		...props,
		fill: color,
		stroke: props.stroke ?? color,
		strokeWidth: props.strokeWidth ?? 0,
	};
}

const { fill: _fill, ...shapePropsWithoutFill } = shapeProps;

/** The props a dot lets `instances()` drive per item. */
type DotInstanceable =
	| Exclude<ShapeInstanceable, "fill">
	| "center"
	| "radius"
	| "color";

const dotProps: PropsDescriptor<DotProps, DotInstanceable> = {
	...shapePropsWithoutFill,
	// Read by `offset` alone: a move is a new matrix, never a new outline.
	center: { invalidates: Invalidate.TRANSFORM, instanceable: true },
	radius: {
		default: DOT_RADIUS,
		invalidates: Invalidate.GEOMETRY,
		instanceable: true,
	},
	color: { invalidates: Invalidate.STYLE, instanceable: true },
	// The stroke falls back to `color` and the width to 0, so both restyle.
	strokeWidth: { invalidates: Invalidate.STYLE, instanceable: true },
};

/**
 * A small filled disc that marks a point of interest.
 *
 * Filled with the theme accent unless `color` says otherwise. It has no
 * outline by default (`strokeWidth` defaults to 0, unlike the theme stroke
 * width other shapes get), because a dot is a filled mark whose size is
 * exactly `radius`. It takes a single `color` rather than `fill`/`stroke` (see
 * `ShapeProps` for the naming rule); `stroke` and `strokeWidth` add a ring.
 * Use `center` to position it, as for `circle`.
 *
 * @example
 * ```ts
 * import { createScene, dot } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const node = scene.root.add(dot.create({ center: { x: 1, y: 1 } }));
 * node.set("center", { x: 2, y: 1 }); // a move: the outline is kept
 * ```
 *
 * @see {@link annotationDot}
 * @see {@link labeledDot}
 *
 * @category Shapes
 */
export const dot = defineShape<DotProps, DotInstanceable>({
	name: "Dot",
	props: dotProps,
	geometry: (props) => discGeometry(props.radius ?? DOT_RADIUS),
	offset: (props) => props.center,
	// `instances(dot, ...)` draws discs: the renderer's splat fast path.
	instanceMark: (props) => ({
		kind: "circle",
		radius: props.radius ?? DOT_RADIUS,
	}),
	styleProps: dotStyle,
});

/** @category Shapes */
export interface AnnotationDotProps extends DotProps {
	/**
	 * Outline colour. Defaults to the theme foreground, which is the contrast
	 * `color` is chosen against everywhere else in the palette. Ignored when
	 * `stroke` is given.
	 */
	outline?: string;
}

/**
 * A bigger dot with a contrasting ring: Manim's `AnnotationDot`, the marker
 * for "this point, the one I am talking about".
 *
 * The ring is the whole idea: a plain `dot` in a series colour disappears
 * into a plot stroked in the same family, whereas a ring in the foreground
 * colour separates the marker from whatever it is sitting on.
 *
 * Radius defaults to 1.3 times {@link dot}'s, and the ring to 0.05 scene units.
 *
 * @example
 * ```ts
 * import { annotationDot, createScene } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(annotationDot.create({ center: { x: 0, y: 1 } }));
 * ```
 *
 * @category Shapes
 */
export const annotationDot = defineShape<AnnotationDotProps, DotInstanceable>({
	name: "AnnotationDot",
	props: {
		...dotProps,
		radius: {
			default: DOT_RADIUS * 1.3,
			invalidates: Invalidate.GEOMETRY,
			instanceable: true,
		},
		outline: { invalidates: Invalidate.STYLE },
	},
	geometry: (props) => discGeometry(props.radius ?? DOT_RADIUS * 1.3),
	offset: (props) => props.center,
	styleProps: (props, theme) =>
		dotStyle(
			{
				...props,
				color: props.color ?? theme.palette.accent,
				stroke: props.stroke ?? props.outline ?? theme.palette.foreground,
				strokeWidth: props.strokeWidth ?? 0.05,
			},
			theme,
		),
});

/** @category Shapes */
export interface LabeledDotProps extends Omit<DotProps, "radius"> {
	/** The text drawn inside the dot. */
	text: string;
	/**
	 * In scene units.
	 * @default 0.28
	 */
	fontSize?: number;
	/** CSS font family. Defaults to the theme's. */
	fontFamily?: string;
	/**
	 * CSS font weight.
	 * @default 500
	 */
	fontWeight?: string | number;
	/**
	 * Italicise the text.
	 * @default false
	 */
	italic?: boolean;
	/** Text colour. Defaults to the theme background, to read against `color`. */
	textColor?: ColorInput;
	/**
	 * Clearance between the text's box and the dot's edge.
	 * @default 0.1
	 */
	padding?: number;
	/**
	 * Smallest radius the dot takes, in scene units. A floor, not an override:
	 * the dot still grows to fit its text. Defaults to 0.09.
	 */
	minRadius?: number;
}

/**
 * Default `labeledDot` font size, in scene units.
 *
 * @category Shapes
 */
export const LABELED_DOT_FONT_SIZE = 0.28;
const LABELED_DOT_PADDING = 0.1;

/**
 * Everything `labeledDotRadius` needs to measure a label.
 *
 * @category Shapes
 */
export interface LabeledDotMetrics {
	/** In scene units. Defaults to `LABELED_DOT_FONT_SIZE` (0.28). */
	fontSize?: number;
	/** CSS font family. Defaults to the theme's. */
	fontFamily?: string;
	/**
	 * CSS font weight.
	 * @default 500
	 */
	fontWeight?: string | number;
	/**
	 * Italic text.
	 * @default false
	 */
	italic?: boolean;
	/**
	 * Clearance between the text's box and the disc's edge.
	 * @default 0.1
	 */
	padding?: number;
	/** A floor, not an override: see `labeledDot`. */
	minRadius?: number;
}

/**
 * The radius a `labeledDot` will actually take, in scene units.
 *
 * Exported because a *caller* sometimes needs the answer before the node
 * exists: a directed graph has to know how big a vertex is to stop its
 * arrowheads from ending up buried inside one. Deriving it twice would let
 * the two disagree the moment a font default changes, so there is one
 * function and `labeledDot` calls it too.
 *
 * `perUnit` is pixels per scene unit: `measureText` speaks device pixels, and
 * the result is divided back out.
 *
 * @example
 * ```ts
 * import { labeledDotRadius } from "@sophistry/core";
 *
 * const radius = labeledDotRadius("12", {}, 1, "sans-serif");
 * ```
 *
 * @param text - The label drawn inside the dot.
 * @param style - Font and spacing options that affect the measured size.
 * @param perUnit - Pixels per scene unit of the enclosing space.
 * @param fontFamily - Fallback font family when `style.fontFamily` is unset.
 * @returns The dot radius in scene units.
 *
 * @category Shapes
 */
export function labeledDotRadius(
	text: string,
	style: LabeledDotMetrics,
	perUnit: number,
	fontFamily: string,
): number {
	const scale = perUnit || 1;
	const fontSize = style.fontSize ?? LABELED_DOT_FONT_SIZE;
	const box = labelBox(text, {
		fontSize: fontSize * scale,
		fontFamily: style.fontFamily ?? fontFamily,
		fontWeight: style.fontWeight ?? DEFAULT_FONT_WEIGHT,
		italic: style.italic ?? false,
		letterSpacing: 0,
		align: "center",
		baseline: "middle",
	});
	const fit =
		(style.padding ?? LABELED_DOT_PADDING) +
		Math.max(boundsWidth(box), boundsHeight(box)) / scale / 2;
	return Math.max(style.minRadius ?? DOT_RADIUS, fit);
}

/** The text and measuring props: what reruns the composite's `update`. */
const labeledDotOwnProps = {
	text: { invalidates: Invalidate.UPDATE },
	fontSize: { default: LABELED_DOT_FONT_SIZE, invalidates: Invalidate.UPDATE },
	fontFamily: { invalidates: Invalidate.UPDATE },
	fontWeight: { default: DEFAULT_FONT_WEIGHT, invalidates: Invalidate.UPDATE },
	italic: { default: false, invalidates: Invalidate.UPDATE },
	textColor: { invalidates: Invalidate.UPDATE },
	padding: { default: LABELED_DOT_PADDING, invalidates: Invalidate.UPDATE },
	minRadius: { default: DOT_RADIUS, invalidates: Invalidate.UPDATE },
	// The text sits on the disc's centre plus its translation.
	center: { invalidates: Invalidate.UPDATE },
	x: { default: 0, invalidates: Invalidate.UPDATE },
	y: { default: 0, invalidates: Invalidate.UPDATE },
} as const;

/** The dot props the composite forwards to its disc as they are. */
const labeledDotForwarded = forwardedProps<
	Omit<DotProps, "radius">,
	"center" | "x" | "y"
>(dotProps as PropsDescriptor<Omit<DotProps, "radius">>, ["center", "x", "y"]);

const labeledDotForwardedKeys = Object.keys(
	labeledDotForwarded,
) as (keyof LabeledDotProps)[];

const labeledDotProps: PropsDescriptor<LabeledDotProps> = {
	...labeledDotForwarded,
	...labeledDotOwnProps,
};

/**
 * A dot with a label centred inside it: Manim's `LabeledDot`, for numbered
 * nodes and named points.
 *
 * The radius grows to fit the text, exactly as Manim's does: `padding` plus half
 * the larger side of the measured box, so a "10" and a "1" both sit clear of
 * the edge. `minRadius`, if given, is a *floor* rather than an override: asking for a
 * dot too small to hold its own text is a request to lose the text.
 *
 * Measurement goes through the metrics oracle in device pixels (that is what
 * `measureText` speaks) and is divided back by the space's pixels-per-unit,
 * the same round trip `label` makes for its own bounds. The space's scale is
 * read when the text, its font, the padding or the theme change.
 *
 * It is a composite of two nodes, a `dot` and a `label`; translation, `place`,
 * `progress`, `opacity`, `zIndex` and `visible` reach both (the label wipes
 * in as the disc draws). `rotation`/`scale` turn the disc alone, since
 * rotating the disc has no visible effect and rotating the text with it
 * rarely reads well.
 *
 * @example
 * ```ts
 * import { createScene, labeledDot } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(labeledDot.create({ text: "A", center: { x: 1, y: 0 } }));
 * ```
 *
 * @see {@link labeledDotRadius}
 *
 * @category Shapes
 */
export const labeledDot = defineComposite<LabeledDotProps>({
	name: "LabeledDot",
	props: labeledDotProps,
	setup: (ctx) => {
		const disc = dot.create({ radius: DOT_RADIUS });
		forwardProps(ctx, disc, labeledDotForwardedKeys);
		const text = label.create({
			text: "",
			place: rawProp(ctx, "place"),
			progress: rawProp(ctx, "progress"),
			opacity: rawProp(ctx, "opacity"),
			zIndex: rawProp(ctx, "zIndex"),
			visible: rawProp(ctx, "visible"),
		});
		refreshLabeledDot(ctx, disc, text);
		return [disc, text];
	},
	update: (changed, ctx) => {
		const [disc, text] = ctx.node.children as [DotNode, LabelNode];
		forwardHandlers(changed, ctx, disc);
		refreshLabeledDot(ctx, disc, text);
		return undefined;
	},
});

type DotNode = ReturnType<typeof dot.create>;

type LabelNode = ReturnType<typeof label.create>;

/**
 * Writes what the disc and the text take from the composite's own props:
 * the measured radius, the centre and the text's style. Unchanged values are
 * free to write again.
 */
function refreshLabeledDot(
	ctx: CompositeContext<LabeledDotProps>,
	disc: DotNode,
	text: LabelNode,
): void {
	const props = ctx.props;
	const theme = ctx.theme;
	disc.update({
		radius: labeledDotRadius(
			props.text,
			props,
			scaleFactorOf(ctx.space(SpaceChange.MATRIX).matrix),
			theme.defaults.fontFamily,
		),
		center: props.center,
		x: props.x,
		y: props.y,
	});
	// The text is a separate node, so it is positioned by hand: the disc's
	// `x`/`y` are a transform on the disc alone.
	text.update({
		text: props.text,
		x: (props.center?.x ?? 0) + (props.x ?? 0),
		y: (props.center?.y ?? 0) + (props.y ?? 0),
		fontSize: props.fontSize ?? LABELED_DOT_FONT_SIZE,
		fontFamily: props.fontFamily,
		fontWeight: props.fontWeight,
		italic: props.italic,
		color: props.textColor ?? theme.palette.background,
	});
}
