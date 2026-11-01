/**
 * Shared plumbing for every shape: `defineShape`, the shared `shapeProps`
 * descriptor and the `ShapeNode` pipeline behind them.
 *
 * A shape definition's only job is to produce ideal geometry in its own
 * units; this module handles the rest: transform accumulation, theme
 * defaults, unit scaling, gradients, reveal, interaction and handles. The
 * spec it publishes is in the scene's units (see `spec/types.ts`); the camera
 * is the renderer's business.
 *
 * The pipeline runs as stages:
 *
 * - `GEOMETRY` reruns the definition's `geometry(props)` (lazily: only once
 *   something needs the outline), drops the flattened polylines derived from
 *   it, and drops the base style too when that paints a box gradient.
 * - `STYLE` drops the base style (paints, widths, dashes, opacity, theme,
 *   the space's opacity), rebuilt on the next read.
 * - `TRANSFORM` and `SPEC` only reassemble the spec. Everything the assembly
 *   derives (local TRS, matrix, pen scale, scaled style, write, baked
 *   outlines, the spec itself) sits behind a last-input cache, so it skips
 *   work whose inputs did not change and keeps its result's identity, which
 *   the renderer's caches key on. A move is a new matrix: the outline arrays
 *   stay the same objects.
 */

import { boundsOf } from "../geometry/bounds.js";
import type { Bounds, CurvePath, Point, Polyline } from "../geometry/index.js";
import type { Matrix } from "../geometry/transform.js";
import {
	compose,
	IDENTITY,
	scaleFactorOf,
	translate,
} from "../geometry/transform.js";
import type { InteractionProps } from "../interact/types.js";
import type { ShapeGeometry, StrokeAlongInput } from "../spec/bake.js";
import {
	bakeCurvePaths,
	bakeLocalTransform,
	bakeMatrix,
	bakePaintFrame,
	bakePolylines,
	bakeShapeSpec,
	bakeStrokeStyle,
	derivePolylines,
	flattenCurves,
	isSimilarity,
	resolveWrite,
} from "../spec/bake.js";
import type { PaintSpec } from "../spec/gradient.js";
import { isGradientSpec } from "../spec/gradient.js";
import type { Placement } from "../spec/layout.js";
import { readDelta } from "../spec/layout.js";
import type { ClipRegion, ShapeSpec, StrokeStyle } from "../spec/types.js";
import type { Theme } from "../themes/types.js";
import { Invalidate, themeContext } from "./context.js";
import { interactionProps } from "./interaction-props.js";
import { ANY_CONTEXT, BaseNode, memo, sameMatrix } from "./node.js";
import { definePrimitive } from "./primitive.js";
import type {
	ContextKey,
	DeclaredInstanceable,
	Definition,
	InvalidateBits,
	PropsDescriptor,
	SceneNode,
} from "./types.js";
import { SpaceChange } from "./types.js";

export type { ShapeGeometry } from "../spec/bake.js";

/**
 * Styling, transform and interaction props every shape accepts, on top of its
 * own geometry props. Lengths are scene units and angles radians; unset colours
 * come from the theme.
 *
 * @see {@link https://sophistry.dev/guides/shapes-and-styling/#shared-props}
 * @category Extending
 */
export interface ShapeProps extends InteractionProps {
	/**
	 * Outline paint: a colour, a gradient (`linearGradient`, `radialGradient`,
	 * `sheen`) or `"none"`. Defaults to the theme foreground.
	 */
	stroke?: PaintSpec;
	/** Outline thickness. Defaults to the theme's stroke width. */
	strokeWidth?: number;
	/** Interior paint, like `stroke`. Only closed shapes show it. Defaults to none. */
	fill?: PaintSpec;
	/**
	 * Colours spread along the outline by arc length (often a `colorRamp`), for a
	 * path that changes colour as it goes; a gradient `stroke` runs along a
	 * straight axis instead. Pass `{ colors, scope: "polyline" }` to restart on
	 * each polyline.
	 * @see {@link https://sophistry.dev/guides/shapes-and-styling/#fills-strokes-and-gradients}
	 */
	strokeAlong?: StrokeAlongInput;
	/**
	 * Opacity, 0..1, multiplied with enclosing groups'.
	 * @default 1
	 */
	opacity?: number;
	/**
	 * Opacity of the fill alone, 0..1, on top of `opacity`.
	 * @default 1
	 */
	fillOpacity?: number;
	/** Dash pattern, alternating ink and gap lengths, e.g. `[0.2, 0.1]`. Defaults to solid. */
	dash?: number[];
	/**
	 * Where in the `dash` pattern the stroke starts.
	 * @default 0
	 */
	dashOffset?: number;
	/**
	 * How stroke ends are capped.
	 * @default `"round"`
	 */
	lineCap?: CanvasLineCap;
	/**
	 * How stroke corners are joined.
	 * @default `"round"`
	 */
	lineJoin?: CanvasLineJoin;
	/**
	 * Arc-length reveal, 0..1: the fraction of the outline drawn. `draw()` and
	 * `erase()` drive it.
	 * @default 1
	 */
	progress?: number;
	/**
	 * Paint order; higher draws later. Ties paint in tree order.
	 * @default 0
	 */
	zIndex?: number;
	/**
	 * `false` removes the shape from the frame entirely.
	 * @default true
	 */
	visible?: boolean;
	/**
	 * A `Placement` from a layout helper (`nextTo`, `arrange`, ...); adds to
	 * `x`/`y`.
	 */
	place?: Placement;
	/**
	 * Horizontal translation, applied on top of any enclosing `group`.
	 * @default 0
	 */
	x?: number;
	/**
	 * Vertical translation (up is positive on a y-up stage).
	 * @default 0
	 */
	y?: number;
	/** Rotation about `origin` in radians; positive is counter-clockwise on a y-up stage. */
	rotation?: number;
	/**
	 * Uniform scale about `origin`.
	 * @default 1
	 */
	scale?: number;
	/** Pivot for rotation/scale. Defaults to the shape's centre. */
	origin?: Point;
}

/**
 * Descriptor entries for every {@link ShapeProps} key, each invalidating the
 * cheapest stage that is right: paints `STYLE`, placement `TRANSFORM`,
 * `progress`/`zIndex`/`visible` `SPEC`, interaction props the interaction
 * record. Spread it into a shape's own descriptor:
 *
 * ```ts
 * props: { ...shapeProps, radius: { invalidates: Invalidate.GEOMETRY, instanceable: true } }
 * ```
 *
 * @category Extending
 */
export const shapeProps: PropsDescriptor<ShapeProps, ShapeInstanceable> =
	Object.freeze({
		...interactionProps,
		stroke: { invalidates: Invalidate.STYLE, instanceable: true },
		strokeWidth: { invalidates: Invalidate.STYLE, instanceable: true },
		fill: { invalidates: Invalidate.STYLE, instanceable: true },
		strokeAlong: { invalidates: Invalidate.STYLE },
		opacity: { default: 1, invalidates: Invalidate.STYLE, instanceable: true },
		fillOpacity: {
			default: 1,
			invalidates: Invalidate.STYLE,
			instanceable: true,
		},
		dash: { invalidates: Invalidate.STYLE },
		dashOffset: {
			default: 0,
			invalidates: Invalidate.STYLE,
			instanceable: true,
		},
		lineCap: { default: "round", invalidates: Invalidate.STYLE },
		lineJoin: { default: "round", invalidates: Invalidate.STYLE },
		progress: { default: 1, invalidates: Invalidate.SPEC, instanceable: true },
		zIndex: { default: 0, invalidates: Invalidate.SPEC },
		visible: { default: true, invalidates: Invalidate.SPEC },
		place: { invalidates: Invalidate.TRANSFORM },
		x: { default: 0, invalidates: Invalidate.TRANSFORM, instanceable: true },
		y: { default: 0, invalidates: Invalidate.TRANSFORM, instanceable: true },
		rotation: {
			default: 0,
			invalidates: Invalidate.TRANSFORM,
			instanceable: true,
		},
		scale: {
			default: 1,
			invalidates: Invalidate.TRANSFORM,
			instanceable: true,
		},
		origin: { invalidates: Invalidate.TRANSFORM },
	});

/**
 * The {@link ShapeProps} keys `shapeProps` marks `instanceable`: what every
 * shape lets `instances()` drive per item. A shape declaring its own
 * instanceable keys adds to it:
 * `defineShape<LineProps, ShapeInstanceable | "from" | "to">(...)`.
 *
 * `progress` is each item's arc-length reveal (as on a single shape): shared
 * by every item in `instances()`'s `shared`, per item as a channel. See
 * `instances`.
 *
 * @category Extending
 */
export type ShapeInstanceable =
	| "stroke"
	| "strokeWidth"
	| "fill"
	| "opacity"
	| "fillOpacity"
	| "dashOffset"
	| "progress"
	| "x"
	| "y"
	| "rotation"
	| "scale";

/**
 * Options for {@link defineShape}.
 *
 * @typeParam P - The shape's props.
 * @typeParam I - The props declared instanceable (see `Definition`).
 *
 * @category Extending
 */
export interface ShapeOptions<P extends ShapeProps, I extends keyof P = never> {
	/** PascalCase display and codegen name (`"Circle"`). */
	name: string;
	/** One entry per prop: `...shapeProps` plus the shape's own. */
	props: PropsDescriptor<P, I>;
	/**
	 * The untransformed outline in the shape's own units, from the props it
	 * reads (unset props are absent: apply their defaults here). Reruns only
	 * when a prop invalidating `Invalidate.GEOMETRY` changes, and only once
	 * something needs the outline. It may return a `Promise` (a font, a worker
	 * result): the shape is left out of the frame until the first one
	 * resolves, and a newer request supersedes an older one.
	 */
	geometry: (props: Readonly<P>) => ShapeGeometry | Promise<ShapeGeometry>;
	/**
	 * Where the outline sits, read on its own: the shape's position prop (a
	 * circle's `center`). With it `geometry` can build the outline about the
	 * origin and depend only on its size, so moving the shape never reruns it:
	 * the move is a new matrix. Give its prop `Invalidate.TRANSFORM`. Wins over
	 * `ShapeGeometry.offset`.
	 */
	offset?: (props: Readonly<P>) => Point | undefined;
	/**
	 * The props the style is baked from, when a shape derives a paint from
	 * its other props or the theme (an arrow fills a closed tip with its
	 * stroke colour, a dot paints its one `color`). Reruns whenever the style
	 * is rebuilt (a `Invalidate.STYLE` prop or the theme changed), so give every
	 * prop it reads `Invalidate.STYLE`. Defaults to the props as set.
	 */
	styleProps?: (props: Readonly<P>, theme: Theme) => Readonly<ShapeProps>;
	/**
	 * How `instances()` may draw an item of this shape as a batched `circle`
	 * or `rect` mark (the renderer's fastest path): the disc or box the
	 * outline *is*, about the origin of `geometry`'s units (placed by
	 * `offset`), or null when these props make something else (a rounded
	 * rect). Give it only when the outline is exactly that disc or box.
	 * Without it, instanced items are drawn as their outlines.
	 */
	instanceMark?: (props: Readonly<P>) => InstanceMark | null;
}

/**
 * What a shape's {@link ShapeOptions.instanceMark} returns: an item drawn as
 * a disc of `radius` or an axis-aligned box of `halfWidth` by `halfHeight`,
 * centred on the origin of the shape's own units.
 *
 * @example
 * ```ts
 * import { defineShape, type ShapeProps, shapeProps, Invalidate } from "@sophistry/core";
 * import { circlePolyline } from "@sophistry/core/geometry";
 *
 * interface DiscProps extends ShapeProps {
 * 	radius: number;
 * }
 *
 * export const disc = defineShape<DiscProps>({
 * 	name: "Disc",
 * 	props: { ...shapeProps, radius: { default: 1, invalidates: Invalidate.GEOMETRY } },
 * 	geometry: (props) => ({ closed: true, polylines: [circlePolyline(0, 0, props.radius)] }),
 * 	instanceMark: (props) => ({ kind: "circle", radius: props.radius }),
 * });
 * ```
 *
 * @category Instancing
 */
export type InstanceMark =
	| { kind: "circle"; radius: number }
	| { kind: "rect"; halfWidth: number; halfHeight: number };

/** A gradient whose endpoints are scene coordinates rather than fractions of the shape's box. */
function sceneGradient(paint: PaintSpec | undefined): boolean {
	return paint !== undefined && isGradientSpec(paint) && paint.units !== "bbox";
}

/** `style` with its lengths in scene units for a matrix of this scale. */
function scaleStyle(style: StrokeStyle, scale: number): StrokeStyle {
	if (scale === 1) return style;
	return {
		...style,
		strokeWidth: style.strokeWidth * scale,
		dash: style.dash ? style.dash.map((d) => d * scale) : null,
		dashOffset: style.dashOffset * scale,
	};
}

/** A pure translation: the common case, a similarity without the arithmetic. */
function isTranslation(m: Matrix): boolean {
	return m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1;
}

/** Whether a style paints with a gradient (whose endpoints depend on the frame). */
function hasGradient(style: StrokeStyle): boolean {
	return (
		(typeof style.stroke !== "string" && style.stroke !== null) ||
		(typeof style.fill !== "string" && style.fill !== null)
	);
}

/**
 * Keeps the previous matrix object while a new one has the same entries, so
 * identity-keyed caches hold.
 *
 * @internal
 */
export function lastMatrix<M extends Matrix | null = Matrix>(): (next: M) => M {
	let last: M | null = null;
	return (next) => {
		if (last && sameMatrix(last, next)) return last;
		last = next;
		return next;
	};
}

/** A thenable: what an async `geometry` returns. */
function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
	return (
		typeof value === "object" &&
		value !== null &&
		typeof (value as { then?: unknown }).then === "function"
	);
}

/** Last inputs and result of a shape's local TRS. */
interface LocalTransformCache {
	shape: ShapeGeometry;
	x: number | undefined;
	y: number | undefined;
	rotation: number | undefined;
	scale: number | undefined;
	origin: Point | undefined;
	placeX: number;
	placeY: number;
	offsetX: number | undefined;
	offsetY: number | undefined;
	matrix: Matrix | null;
}

/** Last inputs and result of the composed matrix. */
interface MatrixCache {
	space: Matrix;
	local: Matrix | null;
	matrix: Matrix;
}

/** Last inputs and result of the scaled style. */
interface ScaledStyleCache {
	base: StrokeStyle;
	scale: number;
	style: StrokeStyle;
}

/** Last inputs and result of the resolved write-on. */
interface WriteCache {
	source: ShapeGeometry["write"];
	scale: number;
	write: ShapeSpec["write"];
}

/** Last inputs and result of the spec. */
interface SpecCache {
	shape: ShapeGeometry;
	style: StrokeStyle;
	matrix: Matrix;
	write: ShapeSpec["write"];
	progress: number;
	zIndex: number | undefined;
	clip: readonly ClipRegion[] | undefined;
	transformed: boolean;
	spec: ShapeSpec;
}

/** Caches of the baked-geometry path, which most shapes never take. */
interface BakedCaches {
	sceneStyle: (
		base: StrokeStyle,
		matrix: Matrix,
		scale: number,
		opacity: number,
		shape: ShapeGeometry,
	) => StrokeStyle;
	lines: typeof bakePolylines;
	curves: typeof bakeCurvePaths;
}

/**
 * A spec's `local`: the outline as authored plus the matrix. `polylines` is a
 * getter on the class, so a curve outline is flattened only when something
 * reads it (a hover, a focus ring), and building one per frame costs a plain
 * allocation: an object literal with a getter is defined through the
 * runtime, about twenty times slower, and every animated shape makes one
 * per frame.
 */
class LocalOutline {
	readonly curvePaths: CurvePath[] | undefined;
	readonly transform: Matrix;
	private readonly outline: Polyline[] | undefined;

	constructor(
		outline: Polyline[] | undefined,
		curvePaths: CurvePath[] | undefined,
		transform: Matrix,
	) {
		this.outline = outline;
		this.curvePaths = curvePaths;
		this.transform = transform;
	}

	get polylines(): Polyline[] {
		return this.outline ?? flattenCurves(this.curvePaths ?? []);
	}
}

/**
 * A shape node: a definition's `geometry` run through the shared shape
 * pipeline. Made by a {@link defineShape} definition's `create`.
 *
 * @typeParam P - The shape's props.
 *
 * @category Extending
 */
export class ShapeNode<P extends ShapeProps = ShapeProps> extends BaseNode<P> {
	override readonly producesSpec = true;

	private readonly options: ShapeOptions<P>;

	/** The outline, or null before the first (async) geometry has resolved. */
	private shape: ShapeGeometry | null = null;
	/** Whether `geometry(props)` must rerun before the outline is read. */
	private geometryStale = true;
	/** Bumped per geometry request, so a late answer to an old one is dropped. */
	private geometryRequest = 0;
	/** An async geometry's rejection, rethrown from the next commit. */
	private geometryError: { error: unknown } | null = null;
	/** `shape` flattened, in the shape's own units. Lazy: built when first needed. */
	private flat: Polyline[] | null = null;
	/**
	 * The style before the matrix's scale, with gradients in local units: what
	 * a transformed shape uses, scaled by `scaledStyle`. Independent of where
	 * the shape is, so a move never rebuilds it. Lazy: a hidden shape restyles
	 * nothing.
	 */
	private baseStyle: StrokeStyle | null = null;

	/*
	 * The assembly's last-input caches. The ones every frame of an animation
	 * passes through (local TRS, matrix, scaled style, write, spec) are
	 * records compared field by field and overwritten in place, not `memo`s:
	 * a `memo` call collects its arguments into a fresh array, and five of
	 * those per shape per frame were a measurable share of a 10k-shape
	 * animation's frame (allocation and the collector behind it). Same rule
	 * as `memo`: the same inputs (by identity) return the same object.
	 */
	private localCache: LocalTransformCache | null = null;
	private matrixCache: MatrixCache | null = null;
	private styleCache: ScaledStyleCache | null = null;
	private writeCache: WriteCache | null = null;
	private specCache: SpecCache | null = null;
	/** The baked-geometry path's caches, made the first time a shape needs it. */
	private baked: BakedCaches | null = null;
	private localBox:
		| ((lines: Polyline[], offsetX: number, offsetY: number) => Polyline[])
		| null = null;
	private handleMatrixOf: ((next: Matrix | null) => Matrix | null) | null =
		null;

	constructor(definition: Definition<P>, options: ShapeOptions<P>) {
		super(definition);
		this.options = options;
	}

	/* ------------------------------------------------------------ stages */

	protected run(dirty: InvalidateBits): void {
		if (dirty & Invalidate.GEOMETRY) this.geometryStale = true;
		if (dirty & Invalidate.STYLE) this.baseStyle = null;
		this.publish(this.assemble());
	}

	protected override stagesForSpace(change: number): InvalidateBits {
		let bits = 0;
		if (change & (SpaceChange.MATRIX | SpaceChange.PEN_SCALE)) {
			bits |= Invalidate.TRANSFORM;
		}
		if (change & SpaceChange.OPACITY) bits |= Invalidate.STYLE;
		if (change & SpaceChange.CLIP) bits |= Invalidate.SPEC;
		return bits;
	}

	protected override stagesForContext(
		key: ContextKey<unknown>,
	): InvalidateBits {
		return key === themeContext || key === ANY_CONTEXT ? Invalidate.STYLE : 0;
	}

	/** The spec for the current props and space, or null when nothing draws. */
	private assemble(): ShapeSpec | null {
		const failure = this.geometryError;
		if (failure) {
			this.geometryError = null;
			this.publish(null);
			throw failure.error;
		}
		const props = this.props;
		if (props.visible === false) return null;
		const shape = this.currentShape();
		if (!shape) return null;
		const base = this.currentBaseStyle(shape);
		const progress = props.progress ?? 1;
		if (progress <= 0 && (base.fillOpacity <= 0 || !base.fill)) return null;

		const space = this.space;
		const matrix = this.matrixFor(
			space.matrix,
			this.localMatrixWithOffset(shape),
		);
		const scale = space.penScale ?? scaleFactorOf(matrix);
		// Hand the renderer the outline in its own units plus this matrix (the
		// default), rather than baking every point into scene units. Not under a
		// skew or non-uniform scale, which would stretch the stroke, and not with
		// a gradient given in scene coordinates, which the canvas would otherwise
		// read in local ones.
		const transformed =
			(isTranslation(matrix) || isSimilarity(matrix)) &&
			!sceneGradient(props.fill) &&
			!sceneGradient(props.stroke);
		// A bbox gradient is resolved in the units it is drawn in: local under
		// the matrix, scene units when baked.
		const style =
			transformed || !hasGradient(base)
				? this.scaledStyle(base, scale)
				: this.bakedCaches().sceneStyle(
						base,
						matrix,
						scale,
						space.opacity,
						shape,
					);
		const write = this.writeFor(shape.write, scale);
		const clamped = Math.min(1, Math.max(0, progress));
		const zIndex = props.zIndex;
		const clip = space.clip;
		const last = this.specCache;
		if (
			last &&
			last.shape === shape &&
			last.style === style &&
			last.matrix === matrix &&
			last.write === write &&
			last.progress === clamped &&
			last.zIndex === zIndex &&
			last.clip === clip &&
			last.transformed === transformed
		)
			return last.spec;
		const spec = this.buildSpec(
			shape,
			style,
			matrix,
			write,
			clamped,
			zIndex,
			clip,
			transformed,
		);
		if (last) {
			last.shape = shape;
			last.style = style;
			last.matrix = matrix;
			last.write = write;
			last.progress = clamped;
			last.zIndex = zIndex;
			last.clip = clip;
			last.transformed = transformed;
			last.spec = spec;
		} else {
			this.specCache = {
				shape,
				style,
				matrix,
				write,
				progress: clamped,
				zIndex,
				clip,
				transformed,
				spec,
			};
		}
		return spec;
	}

	/** A new spec from the assembled pieces (the inputs changed). */
	private buildSpec(
		shape: ShapeGeometry,
		style: StrokeStyle,
		matrix: Matrix,
		write: ShapeSpec["write"],
		progress: number,
		zIndex: number | undefined,
		clip: readonly ClipRegion[] | undefined,
		transformed: boolean,
	): ShapeSpec {
		if (transformed) {
			return bakeShapeSpec({
				id: this.id,
				zIndex,
				closed: shape.closed,
				fillFrom: shape.fillFrom,
				write,
				style,
				progress,
				clip,
				polylines: [],
				// The outline as authored, which a move leaves untouched.
				local: new LocalOutline(shape.polylines, shape.curvePaths, matrix),
			});
		}
		const baked = this.bakedCaches();
		return bakeShapeSpec({
			id: this.id,
			zIndex,
			closed: shape.closed,
			fillFrom: shape.fillFrom,
			write,
			style,
			progress,
			clip,
			polylines: baked.lines(this.flatPolylines(shape), matrix),
			curvePaths: baked.curves(shape.curvePaths, matrix),
		});
	}

	/** The space's matrix with the local TRS on top; the previous object while the entries match. */
	private matrixFor(spaceMatrix: Matrix, local: Matrix | null): Matrix {
		const last = this.matrixCache;
		if (last && last.space === spaceMatrix && last.local === local) {
			return last.matrix;
		}
		// Under the identity space (a shape at the top level) the local matrix
		// is the answer: composing would only copy it.
		const next =
			spaceMatrix === IDENTITY && local
				? local
				: bakeMatrix(spaceMatrix, local);
		const matrix = last && sameMatrix(last.matrix, next) ? last.matrix : next;
		if (last) {
			last.space = spaceMatrix;
			last.local = local;
			last.matrix = matrix;
		} else this.matrixCache = { space: spaceMatrix, local, matrix };
		return matrix;
	}

	/** `base` scaled to scene units for a pen scale of `scale`. */
	private scaledStyle(base: StrokeStyle, scale: number): StrokeStyle {
		const last = this.styleCache;
		if (last && last.base === base && last.scale === scale) return last.style;
		const style = scaleStyle(base, scale);
		if (last) {
			last.base = base;
			last.scale = scale;
			last.style = style;
		} else this.styleCache = { base, scale, style };
		return style;
	}

	/** The write-on spec for a pen scale of `scale`. */
	private writeFor(
		source: ShapeGeometry["write"],
		scale: number,
	): ShapeSpec["write"] {
		const last = this.writeCache;
		if (last && last.source === source && last.scale === scale) {
			return last.write;
		}
		const write = resolveWrite(source, scale);
		if (last) {
			last.source = source;
			last.scale = scale;
			last.write = write;
		} else this.writeCache = { source, scale, write };
		return write;
	}

	/** The baked-geometry path's caches (skewed matrices, scene gradients). */
	private bakedCaches(): BakedCaches {
		this.baked ??= {
			sceneStyle: memo(
				(
					_base: StrokeStyle,
					matrix: Matrix,
					scale: number,
					opacity: number,
					shape: ShapeGeometry,
				) =>
					bakeStrokeStyle(
						this.styleInput(),
						this.context(themeContext),
						scale,
						opacity,
						() => bakePaintFrame(this.flatPolylines(shape), matrix),
					),
			),
			lines: memo(bakePolylines),
			curves: memo(bakeCurvePaths),
		};
		return this.baked;
	}

	/**
	 * The outline, rerunning `geometry` first if a geometry prop changed.
	 * Null while the first async request is pending.
	 */
	private currentShape(): ShapeGeometry | null {
		if (!this.geometryStale) return this.shape;
		this.geometryStale = false;
		const request = ++this.geometryRequest;
		const result = this.options.geometry(this.props);
		if (!isPromise(result)) {
			this.acceptShape(result);
			return result;
		}
		result.then(
			(shape) => {
				if (request !== this.geometryRequest || this.disposed) return;
				this.acceptShape(shape);
				this.invalidate(Invalidate.TRANSFORM);
			},
			(error: unknown) => {
				if (request !== this.geometryRequest || this.disposed) return;
				// Not swallowed: the next commit (or handle read) throws it.
				this.geometryError = { error };
				this.invalidate(Invalidate.SPEC);
			},
		);
		// The previous outline (if any) stays up until the new one arrives.
		return this.shape;
	}

	/** Takes a new outline: drops everything derived from the old one. */
	private acceptShape(shape: ShapeGeometry): void {
		if (shape === this.shape) return;
		this.shape = shape;
		this.flat = null;
		// A box gradient spans the outline, so it moves with a new one.
		if (this.baseStyle && hasGradient(this.baseStyle)) this.baseStyle = null;
	}

	/** `shape` flattened in its own units, built once per outline. */
	private flatPolylines(shape: ShapeGeometry): Polyline[] {
		if (shape !== this.shape) return derivePolylines(shape);
		this.flat ??= derivePolylines(shape);
		return this.flat;
	}

	/** The props the style is baked from: the definition's `styleProps`, else the props as set. */
	private styleInput(): Readonly<ShapeProps> {
		const styleProps = this.options.styleProps;
		return styleProps
			? styleProps(this.props, this.context(themeContext))
			: this.props;
	}

	private currentBaseStyle(shape: ShapeGeometry): StrokeStyle {
		this.baseStyle ??= bakeStrokeStyle(
			this.styleInput(),
			this.context(themeContext),
			1,
			this.space.opacity,
			() => bakePaintFrame(this.flatPolylines(shape), IDENTITY),
		);
		return this.baseStyle;
	}

	/** The outline's offset: the definition's `offset`, else the geometry's own. */
	private offsetOf(shape: ShapeGeometry): Point | undefined {
		return this.options.offset ? this.options.offset(this.props) : shape.offset;
	}

	/** The local TRS with the offset, or null for the identity. */
	private localMatrixWithOffset(shape: ShapeGeometry): Matrix | null {
		const props = this.props;
		let placeX = 0;
		let placeY = 0;
		if (props.place) {
			const delta = readDelta(props.place);
			placeX = delta.x;
			placeY = delta.y;
		}
		const offset = this.offsetOf(shape);
		const offsetX = offset?.x;
		const offsetY = offset?.y;
		const last = this.localCache;
		if (
			last &&
			last.shape === shape &&
			last.x === props.x &&
			last.y === props.y &&
			last.rotation === props.rotation &&
			last.scale === props.scale &&
			last.origin === props.origin &&
			last.placeX === placeX &&
			last.placeY === placeY &&
			last.offsetX === offsetX &&
			last.offsetY === offsetY
		)
			return last.matrix;
		const matrix = this.bakeLocal(shape, placeX, placeY, offsetX, offsetY);
		if (last) {
			last.shape = shape;
			last.x = props.x;
			last.y = props.y;
			last.rotation = props.rotation;
			last.scale = props.scale;
			last.origin = props.origin;
			last.placeX = placeX;
			last.placeY = placeY;
			last.offsetX = offsetX;
			last.offsetY = offsetY;
			last.matrix = matrix;
		} else {
			this.localCache = {
				shape,
				x: props.x,
				y: props.y,
				rotation: props.rotation,
				scale: props.scale,
				origin: props.origin,
				placeX,
				placeY,
				offsetX,
				offsetY,
				matrix,
			};
		}
		return matrix;
	}

	/** `bakeLocalTransform` for the current props. */
	private bakeLocal(
		shape: ShapeGeometry,
		placeX: number,
		placeY: number,
		offsetX: number | undefined,
		offsetY: number | undefined,
	): Matrix | null {
		const props = this.props;
		const scale = props.scale;
		if (!props.rotation && (scale === undefined || scale === 1)) {
			// `bakeLocalTransform`'s pure-translation branch, inlined: a move is
			// this branch every frame, and the call would first wrap its inputs
			// in three objects.
			const hasOffset = offsetX !== undefined;
			const tx = (props.x ?? 0) + placeX + (hasOffset ? offsetX : 0);
			const ty = (props.y ?? 0) + placeY + (hasOffset ? (offsetY ?? 0) : 0);
			return tx || ty ? translate(tx, ty) : null;
		}
		return bakeLocalTransform(
			{
				x: props.x,
				y: props.y,
				rotation: props.rotation,
				scale,
				origin: props.origin,
			},
			{ x: placeX, y: placeY },
			() => this.flatPolylines(shape),
			offsetX === undefined ? undefined : { x: offsetX, y: offsetY as number },
		);
	}

	/* ----------------------------------------------------------- handles */

	/**
	 * A handle's box: the outline where its offset puts it, before the local
	 * TRS. The same array while neither the outline nor the offset changed.
	 */
	protected override localOutline(): readonly Polyline[] | null {
		const shape = this.currentShape();
		if (!shape) return null;
		const offset = this.offsetOf(shape);
		this.localBox ??= memo(
			(lines: Polyline[], offsetX: number, offsetY: number): Polyline[] =>
				offsetX || offsetY
					? bakePolylines(lines, translate(offsetX, offsetY))
					: lines,
		);
		return this.localBox(
			this.flatPolylines(shape),
			offset?.x ?? 0,
			offset?.y ?? 0,
		);
	}

	/** A handle's matrix: the local TRS without the offset. */
	protected override localMatrix(): Matrix | null {
		const shape = this.currentShape();
		if (!shape) return null;
		const offset = this.offsetOf(shape);
		const own = this.localMatrixWithOffset(shape);
		this.handleMatrixOf ??= lastMatrix<Matrix | null>();
		if (!offset || (!offset.x && !offset.y)) return this.handleMatrixOf(own);
		const back = translate(-offset.x, -offset.y);
		return this.handleMatrixOf(own ? compose(own, back) : back);
	}

	protected override disposeContents(): void {
		// A request still in flight lands nowhere.
		this.geometryRequest++;
	}
}

/**
 * Makes a shape definition: a descriptor and a `geometry` function, run
 * through the shared shape pipeline (theme defaults, transform props, the
 * enclosing space, gradients, reveal, interaction, handles). This is how
 * every built-in shape is made; see "How to write a primitive" in
 * `scene/primitive.ts` and `shapes/circle.ts` for the reference.
 *
 * @example
 * ```ts
 * import { defineShape, type Point, type ShapeProps, shapeProps, Invalidate } from "@sophistry/core";
 *
 * interface CrossProps extends ShapeProps {
 * 	center?: Point;
 * 	size: number;
 * }
 *
 * export const cross = defineShape<CrossProps>({
 * 	name: "Cross",
 * 	props: {
 * 		...shapeProps,
 * 		center: { invalidates: Invalidate.TRANSFORM, instanceable: true },
 * 		size: { invalidates: Invalidate.GEOMETRY, instanceable: true },
 * 	},
 * 	geometry: (props) => ({
 * 		closed: false,
 * 		polylines: [
 * 			[{ x: -props.size, y: 0 }, { x: props.size, y: 0 }],
 * 			[{ x: 0, y: -props.size }, { x: 0, y: props.size }],
 * 		],
 * 	}),
 * 	offset: (props) => props.center,
 * });
 * ```
 *
 * @param options - See {@link ShapeOptions}.
 * @returns The definition; `create(props)` makes a {@link ShapeNode}.
 * @category Extending
 */
export function defineShape<P extends ShapeProps, I extends keyof P = never>(
	options: ShapeOptions<P, I>,
): Definition<P, ShapeNode<P>, DeclaredInstanceable<P, I>> {
	const definition = definePrimitive<P, ShapeNode<P>, I>({
		name: options.name,
		props: options.props,
		node: (made) => new ShapeNode<P>(made, options as ShapeOptions<P>),
	});
	shapeOptionsByDefinition.set(definition, options);
	return definition;
}

/** Each shape definition's options, for `instances()` (which runs `geometry` per item). */
const shapeOptionsByDefinition = new WeakMap<object, unknown>();

/**
 * @internal The options a {@link defineShape} definition was made from, or
 * undefined for any other definition: how `instances()` reads a shape's
 * `geometry` and `offset`.
 */
export function shapeOptionsOf<P extends ShapeProps>(
	definition: Definition<P, SceneNode<P>, keyof P>,
): ShapeOptions<P> | undefined {
	return shapeOptionsByDefinition.get(definition) as
		| ShapeOptions<P>
		| undefined;
}

/**
 * Bounding box of a set of polylines, or `null` when none of them has a point
 * (`boundsOf([])` would be infinite).
 *
 * @param polylines - Polylines in any one coordinate space.
 * @returns The enclosing box in that same space, or `null` if empty.
 *
 * @category Extending
 */
export function boundsOfPolylines(
	polylines: readonly Polyline[],
): Bounds | null {
	if (!polylines.some((line) => line.length > 0)) return null;
	return boundsOf(polylines as Polyline[]);
}
