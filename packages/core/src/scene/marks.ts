/**
 * Batched nodes: many items of one shape as one scene node ({@link MarksSpec}),
 * and a raster laid onto the scene ({@link ImageSpec}).
 *
 * A shape node keeps a pipeline per node: outline, style, matrix, spec, an
 * interaction record and a handle. That is the right price for a shape with
 * its own identity, animation and handlers, and the wrong one for the
 * 50,000th point of a scatter. `defineMarks` makes **one** node for a whole
 * layer: the definition computes typed arrays in its own units and the node
 * maps them through the enclosing space in one pass. Hover and taps still
 * resolve per item: handlers receive the item under the pointer as
 * `event.item` (see `interact/pick-items.ts`). `defineImage` does the same
 * for a raster.
 *
 * Both follow the shape stages: `GEOMETRY` reruns the definition's function,
 * `STYLE` the shared style, `TRANSFORM` (a space change) the bake into scene
 * units, `SPEC` only the assembly, each behind a last-input cache.
 */

import type { Bounds, Point, Polyline } from "../geometry/index.js";
import type { Matrix } from "../geometry/transform.js";
import {
	applyToPoint,
	IDENTITY,
	scaleFactorOf,
} from "../geometry/transform.js";
import type { InteractionProps } from "../interact/types.js";
import { bakeStrokeStyle } from "../spec/bake.js";
import type { PaintSpec } from "../spec/gradient.js";
import { isGradientSpec } from "../spec/gradient.js";
import type {
	ClipRegion,
	ImagePixels,
	ImageSpec,
	MarkShape,
	MarksSpec,
	StrokeStyle,
} from "../spec/types.js";
import { Invalidate, themeContext } from "./context.js";
import { interactionProps } from "./interaction-props.js";
import { ANY_CONTEXT, BaseNode, memo } from "./node.js";
import { definePrimitive } from "./primitive.js";
import type {
	ContextKey,
	Definition,
	InvalidateBits,
	PropsDescriptor,
} from "./types.js";
import { SpaceChange } from "./types.js";

/**
 * A layer of marks in the definition's own units, before the enclosing
 * `group` space is applied. Arrays are read, never kept or written: hand
 * over new arrays when anything changes.
 *
 * @category Extending
 */
export interface MarksGeometry {
	shape: MarkShape;
	count: number;
	/** Item centres, interleaved `x, y`. */
	centers: Float64Array;
	/** Radius per item (`circle`, `polygon`), or half-width, half-height per item (`rect`). */
	extents: Float64Array;
	/** Each item's fill, or one for all; `"none"` for none. */
	fills: readonly string[] | string;
	/** Per-item opacity 0..1, or null for all 1. */
	alphas?: Float32Array | null;
}

/**
 * Props shared by every item of a marks layer.
 *
 * @category Extending
 */
export interface MarksProps extends InteractionProps {
	/**
	 * Outline paint shared by every item.
	 * @default `"none"`
	 */
	stroke?: PaintSpec;
	/** Outline thickness. Defaults to the theme's stroke width. */
	strokeWidth?: number;
	/** Opacity 0..1, multiplied with enclosing groups'. @default 1 */
	opacity?: number;
	/** Fill opacity 0..1, on top of `opacity`. @default 1 */
	fillOpacity?: number;
	/** 0..1: the layer's reveal, scaling every item's opacity. @default 1 */
	progress?: number;
	/** Paint order. @default 0 */
	zIndex?: number;
	/** `false` removes the layer from the frame. @default true */
	visible?: boolean;
}

/**
 * Descriptor entries for every {@link MarksProps} key.
 *
 * @category Extending
 */
export const marksProps: PropsDescriptor<MarksProps> = Object.freeze({
	...interactionProps,
	stroke: { default: "none", invalidates: Invalidate.STYLE },
	strokeWidth: { invalidates: Invalidate.STYLE },
	opacity: { default: 1, invalidates: Invalidate.STYLE },
	fillOpacity: { default: 1, invalidates: Invalidate.STYLE },
	progress: { default: 1, invalidates: Invalidate.SPEC },
	zIndex: { default: 0, invalidates: Invalidate.SPEC },
	visible: { default: true, invalidates: Invalidate.SPEC },
});

/**
 * Options for {@link defineMarks}.
 *
 * @typeParam P - The layer's props.
 *
 * @category Extending
 */
export interface MarksOptions<P extends MarksProps> {
	/** PascalCase display and codegen name (`"Scatter"`). */
	name: string;
	/** One entry per prop: `...marksProps` plus the definition's own. */
	props: PropsDescriptor<P>;
	/**
	 * The layer in the definition's own units, from the props it reads.
	 * Reruns when a prop invalidating `Invalidate.GEOMETRY` changes.
	 */
	marks: (props: Readonly<P>) => MarksGeometry;
}

/** The scene-unit centres, extents and box of a layer under `m`. */
export function bakeMarks(
	geometry: MarksGeometry,
	m: Matrix,
): { centers: Float64Array; extents: Float64Array; bounds: Bounds | null } {
	const { count, shape } = geometry;
	const identity =
		m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
	const rect = shape.kind === "rect";
	let centers = geometry.centers;
	let extents = geometry.extents;
	if (!identity) {
		centers = new Float64Array(count * 2);
		const { a, b, c, d, e, f } = m;
		for (let i = 0; i < count; i++) {
			const x = geometry.centers[2 * i] as number;
			const y = geometry.centers[2 * i + 1] as number;
			centers[2 * i] = a * x + c * y + e;
			centers[2 * i + 1] = b * x + d * y + f;
		}
		// Rects stay axis-aligned: each half-extent scales by its own axis.
		// Discs and symbols scale by the space's uniform factor, as strokes do.
		const sx = rect ? Math.hypot(m.a, m.b) : scaleFactorOf(m);
		const sy = rect ? Math.hypot(m.c, m.d) : sx;
		if (sx !== 1 || sy !== 1) {
			extents = new Float64Array(geometry.extents.length);
			if (rect) {
				for (let i = 0; i < count; i++) {
					extents[2 * i] = (geometry.extents[2 * i] as number) * sx;
					extents[2 * i + 1] = (geometry.extents[2 * i + 1] as number) * sy;
				}
			} else {
				for (let i = 0; i < count; i++) {
					extents[i] = (geometry.extents[i] as number) * sx;
				}
			}
		}
	}
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < count; i++) {
		const x = centers[2 * i] as number;
		const y = centers[2 * i + 1] as number;
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		const ex = (rect ? extents[2 * i] : extents[i]) as number;
		const ey = rect ? (extents[2 * i + 1] as number) : ex;
		if (!(ex >= 0 && ey >= 0)) continue;
		if (x - ex < minX) minX = x - ex;
		if (x + ex > maxX) maxX = x + ex;
		if (y - ey < minY) minY = y - ey;
		if (y + ey > maxY) maxY = y + ey;
	}
	const bounds = minX <= maxX ? { minX, minY, maxX, maxY } : null;
	return { centers, extents, bounds };
}

/** A box's corners as one ring, or none for no box: what a handle measures. */
function boxRing(box: Bounds | null): Polyline[] {
	if (!box) return [];
	return [
		[
			{ x: box.minX, y: box.minY },
			{ x: box.maxX, y: box.minY },
			{ x: box.maxX, y: box.maxY },
			{ x: box.minX, y: box.maxY },
		],
	];
}

/** The matching stages for a node that bakes through its space (marks, images). */
function bakedStagesForSpace(change: number): InvalidateBits {
	let bits = 0;
	if (change & (SpaceChange.MATRIX | SpaceChange.PEN_SCALE)) {
		bits |= Invalidate.TRANSFORM;
	}
	if (change & SpaceChange.OPACITY) bits |= Invalidate.STYLE;
	if (change & SpaceChange.CLIP) bits |= Invalidate.SPEC;
	return bits;
}

/**
 * A marks node: every item of a layer as one node. Made by a
 * {@link defineMarks} definition's `create`.
 *
 * @typeParam P - The layer's props.
 *
 * @category Extending
 */
export class MarksNode<P extends MarksProps = MarksProps> extends BaseNode<P> {
	override readonly producesSpec = true;

	private readonly options: MarksOptions<P>;
	/** The layer in its own units, or null when a geometry prop changed since. */
	private source: MarksGeometry | null = null;
	/** The shared style, or null when a style prop (or the theme) changed since. */
	private style: StrokeStyle | null = null;
	/** What the style was built for: its pen scale and, for a gradient stroke, the box. */
	private styleScale = Number.NaN;
	private styleBounds: Bounds | null = null;

	private readonly baked = memo(bakeMarks);
	private readonly localBox = memo((source: MarksGeometry) =>
		boxRing(bakeMarks(source, IDENTITY).bounds),
	);
	private readonly specOf = memo(
		(
			source: MarksGeometry,
			baked: ReturnType<typeof bakeMarks>,
			style: StrokeStyle,
			progress: number,
			zIndex: number,
			clip: readonly ClipRegion[] | undefined,
		): MarksSpec => ({
			kind: "marks",
			id: this.id,
			zIndex,
			shape: source.shape,
			count: source.count,
			centers: baked.centers,
			extents: baked.extents,
			fills: source.fills,
			alphas: source.alphas ?? null,
			style,
			progress,
			bounds: baked.bounds,
			clip,
		}),
	);

	constructor(definition: Definition<P>, options: MarksOptions<P>) {
		super(definition);
		this.options = options;
	}

	protected run(dirty: InvalidateBits): void {
		if (dirty & Invalidate.GEOMETRY) this.source = null;
		if (dirty & Invalidate.STYLE) this.style = null;
		this.publish(this.assemble());
	}

	protected override stagesForSpace(change: number): InvalidateBits {
		return bakedStagesForSpace(change);
	}

	protected override stagesForContext(
		key: ContextKey<unknown>,
	): InvalidateBits {
		return key === themeContext || key === ANY_CONTEXT ? Invalidate.STYLE : 0;
	}

	private currentSource(): MarksGeometry {
		this.source ??= this.options.marks(this.props);
		return this.source;
	}

	private assemble(): MarksSpec | null {
		const props = this.props;
		if (props.visible === false) return null;
		const source = this.currentSource();
		if (source.count === 0) return null;
		const space = this.space;
		const baked = this.baked(source, space.matrix);
		return this.specOf(
			source,
			baked,
			this.currentStyle(baked.bounds),
			Math.min(1, Math.max(0, props.progress ?? 1)),
			props.zIndex ?? 0,
			space.clip,
		);
	}

	/** The shared style, rebuilt when its props, its pen scale or (for a gradient) the layer's box changed. */
	private currentStyle(bounds: Bounds | null): StrokeStyle {
		const props = this.props;
		const space = this.space;
		const scale = space.penScale ?? scaleFactorOf(space.matrix);
		const stroke = props.stroke ?? "none";
		const gradient = isGradientSpec(stroke);
		if (
			this.style &&
			scale === this.styleScale &&
			(!gradient || bounds === this.styleBounds)
		)
			return this.style;
		this.styleScale = scale;
		this.styleBounds = bounds;
		this.style = bakeStrokeStyle(
			{
				stroke,
				strokeWidth: props.strokeWidth,
				opacity: props.opacity,
				fillOpacity: props.fillOpacity,
				fill: undefined,
			},
			this.context(themeContext),
			scale,
			space.opacity,
			// A shared gradient stroke spans the layer's box, in scene units.
			() => ({
				box: bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 },
				toScene: (at) => at,
				sceneUnitsPerUnit: 1,
			}),
			space.lengthScale,
		);
		return this.style;
	}

	/** The items' box in the layer's own units, strokes excluded. */
	protected override localOutline(): readonly Polyline[] | null {
		return this.localBox(this.currentSource());
	}
}

/**
 * Makes a marks definition: one node drawing every item `marks(props)`
 * returns, mapped through the enclosing space. Handlers get the item under
 * the pointer as `event.item`.
 *
 * @example
 * ```ts
 * import { defineMarks, type MarksProps, marksProps, Invalidate } from "@sophistry/core";
 *
 * interface DotsProps extends MarksProps {
 * 	points: readonly { x: number; y: number }[];
 * }
 *
 * export const dots = defineMarks<DotsProps>({
 * 	name: "Dots",
 * 	props: { ...marksProps, points: { default: [], invalidates: Invalidate.GEOMETRY } },
 * 	marks: (props) => ({
 * 		shape: { kind: "circle" },
 * 		count: props.points.length,
 * 		centers: Float64Array.from(props.points.flatMap((p) => [p.x, p.y])),
 * 		extents: new Float64Array(props.points.length).fill(0.05),
 * 		fills: "tomato",
 * 	}),
 * });
 * ```
 *
 * @param options - See {@link MarksOptions}.
 * @returns The definition; `create(props)` makes a {@link MarksNode}.
 * @category Extending
 */
export function defineMarks<P extends MarksProps>(
	options: MarksOptions<P>,
): Definition<P, MarksNode<P>> {
	return definePrimitive<P, MarksNode<P>>({
		name: options.name,
		props: options.props,
		node: (definition) => new MarksNode<P>(definition, options),
	});
}

/**
 * A raster in the definition's own units: pixel corner `(0, 0)` at `origin`,
 * the first row spanning `xAxis`, the first column spanning `yAxis`.
 *
 * @category Extending
 */
export interface ImageGeometry {
	pixels: ImagePixels;
	origin: Point;
	xAxis: Point;
	yAxis: Point;
}

/**
 * Props of an image node.
 *
 * @category Extending
 */
export interface ImageProps extends InteractionProps {
	/** Opacity 0..1, multiplied with enclosing groups'. @default 1 */
	opacity?: number;
	/** 0..1: the reveal, scaling opacity. @default 1 */
	progress?: number;
	/** Interpolate between pixels when magnified. @default false */
	smoothing?: boolean;
	/** Paint order. @default 0 */
	zIndex?: number;
	/** `false` removes the image from the frame. @default true */
	visible?: boolean;
}

/**
 * Descriptor entries for every {@link ImageProps} key.
 *
 * @category Extending
 */
export const imageProps: PropsDescriptor<ImageProps> = Object.freeze({
	...interactionProps,
	opacity: { default: 1, invalidates: Invalidate.STYLE, instanceable: true },
	progress: { default: 1, invalidates: Invalidate.SPEC, instanceable: true },
	smoothing: { default: false, invalidates: Invalidate.SPEC },
	zIndex: { default: 0, invalidates: Invalidate.SPEC },
	visible: { default: true, invalidates: Invalidate.SPEC },
});

/**
 * Options for {@link defineImage}.
 *
 * @typeParam P - The image's props.
 *
 * @category Extending
 */
export interface ImageOptions<P extends ImageProps> {
	/** PascalCase display and codegen name (`"Imshow"`). */
	name: string;
	/** One entry per prop: `...imageProps` plus the definition's own. */
	props: PropsDescriptor<P>;
	/**
	 * The raster and its frame in the definition's own units. Reruns when a
	 * prop invalidating `Invalidate.GEOMETRY` changes. Pixels are uploaded once per
	 * `pixels` object, so keep returning the same object until the colours
	 * change.
	 */
	image: (props: Readonly<P>) => ImageGeometry;
}

/** The scene-unit frame of an image under `m`. */
function bakeImageFrame(
	source: ImageGeometry,
	m: Matrix,
): { origin: Point; xAxis: Point; yAxis: Point } {
	// Axes are displacements: the matrix without its translation.
	const axis = (v: Point): Point => ({
		x: m.a * v.x + m.c * v.y,
		y: m.b * v.x + m.d * v.y,
	});
	return {
		origin: applyToPoint(m, source.origin),
		xAxis: axis(source.xAxis),
		yAxis: axis(source.yAxis),
	};
}

/**
 * An image node: a raster mapped through the enclosing space. Made by a
 * {@link defineImage} definition's `create`.
 *
 * @typeParam P - The image's props.
 *
 * @category Extending
 */
export class ImageNode<P extends ImageProps = ImageProps> extends BaseNode<P> {
	override readonly producesSpec = true;

	private readonly options: ImageOptions<P>;
	/** The raster in its own units, or null when a geometry prop changed since. */
	private source: ImageGeometry | null = null;

	private readonly frameOf = memo(bakeImageFrame);
	private readonly localBox = memo((source: ImageGeometry): Polyline[] => {
		const { origin, xAxis, yAxis } = source;
		return [
			[
				origin,
				{ x: origin.x + xAxis.x, y: origin.y + xAxis.y },
				{ x: origin.x + xAxis.x + yAxis.x, y: origin.y + xAxis.y + yAxis.y },
				{ x: origin.x + yAxis.x, y: origin.y + yAxis.y },
			],
		];
	});
	private readonly specOf = memo(
		(
			source: ImageGeometry,
			frame: ReturnType<typeof bakeImageFrame>,
			smoothing: boolean,
			opacity: number,
			progress: number,
			zIndex: number,
			clip: readonly ClipRegion[] | undefined,
		): ImageSpec => ({
			kind: "image",
			id: this.id,
			zIndex,
			pixels: source.pixels,
			origin: frame.origin,
			xAxis: frame.xAxis,
			yAxis: frame.yAxis,
			smoothing,
			opacity,
			progress,
			clip,
		}),
	);

	constructor(definition: Definition<P>, options: ImageOptions<P>) {
		super(definition);
		this.options = options;
	}

	protected run(dirty: InvalidateBits): void {
		if (dirty & Invalidate.GEOMETRY) this.source = null;
		this.publish(this.assemble());
	}

	protected override stagesForSpace(change: number): InvalidateBits {
		return bakedStagesForSpace(change);
	}

	private currentSource(): ImageGeometry {
		this.source ??= this.options.image(this.props);
		return this.source;
	}

	private assemble(): ImageSpec | null {
		const props = this.props;
		if (props.visible === false) return null;
		const source = this.currentSource();
		const space = this.space;
		return this.specOf(
			source,
			this.frameOf(source, space.matrix),
			props.smoothing ?? false,
			(props.opacity ?? 1) * space.opacity,
			Math.min(1, Math.max(0, props.progress ?? 1)),
			props.zIndex ?? 0,
			space.clip,
		);
	}

	/** The raster's parallelogram in its own units. */
	protected override localOutline(): readonly Polyline[] | null {
		return this.localBox(this.currentSource());
	}
}

/**
 * Makes an image definition: one node drawing `image(props)`'s pixels,
 * mapped through the enclosing space. Handlers get the pixel under the
 * pointer as `event.item` (`row * width + column`).
 *
 * @example
 * ```ts
 * import { defineImage, type ImageGeometry, type ImageProps, imageProps, Invalidate } from "@sophistry/core";
 *
 * interface BitmapProps extends ImageProps {
 * 	pixels: ImageGeometry["pixels"]; // { width, height, data: RGBA bytes }
 * }
 *
 * export const bitmap = defineImage<BitmapProps>({
 * 	name: "Bitmap",
 * 	props: { ...imageProps, pixels: { invalidates: Invalidate.GEOMETRY } },
 * 	image: (props) => ({
 * 		pixels: props.pixels,
 * 		origin: { x: 0, y: 1 },
 * 		xAxis: { x: 1, y: 0 },
 * 		yAxis: { x: 0, y: -1 },
 * 	}),
 * });
 * ```
 *
 * @param options - See {@link ImageOptions}.
 * @returns The definition; `create(props)` makes an {@link ImageNode}.
 * @category Extending
 */
export function defineImage<P extends ImageProps>(
	options: ImageOptions<P>,
): Definition<P, ImageNode<P>> {
	return definePrimitive<P, ImageNode<P>>({
		name: options.name,
		props: options.props,
		node: (definition) => new ImageNode<P>(definition, options),
	});
}
