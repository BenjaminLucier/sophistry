/**
 * Path batches: many distinct outlines (pie wedges, ribbons, areas, the
 * lines of a multi-series chart) as one scene node publishing one `paths`
 * `MarksSpec`.
 *
 * Each item is an outline (polylines and/or curves, open or closed) with
 * optional paints of its own; the node's shared props (`marksProps`, plus a
 * shared `fill`) cover the rest. Items paint in order, each filled (when
 * closed) and then stroked as its own shape would be, and hover and taps
 * resolve per item (`event.item` is the item's index).
 *
 * Stages: `GEOMETRY` reruns `paths(props)` and prepares each outline once
 * (about its own box centre, so culling, the focus ring and keyboard order
 * see where each item is); `TRANSFORM` (a space change) only places the
 * items (centres, one shared linear part), so a pan or zoom of the enclosing
 * group re-tessellates nothing; `STYLE` rebuilds the paints; `SPEC` only the
 * assembly. Each sits behind a last-input cache, and an unchanged spec keeps
 * its identity.
 */

import { cssColor } from "../color/parse.js";
import { boundsOf, centerOf } from "../geometry/bounds.js";
import type { Bounds, CurvePath, Point, Polyline } from "../geometry/index.js";
import type { Matrix } from "../geometry/transform.js";
import {
	applyToCurvePath,
	IDENTITY,
	scaleFactorOf,
	translate,
} from "../geometry/transform.js";
import { bakeStrokeStyle, flattenCurves } from "../spec/bake.js";
import type { PaintSpec } from "../spec/gradient.js";
import { isGradientSpec } from "../spec/gradient.js";
import type {
	ClipRegion,
	MarkOutline,
	MarkShape,
	MarksSpec,
	StrokeStyle,
} from "../spec/types.js";
import type { Theme } from "../themes/types.js";
import { Invalidate, themeContext } from "./context.js";
import type { MarksProps } from "./marks.js";
import { marksProps } from "./marks.js";
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
 * One item of a path batch: an outline in the batch's own units, and
 * optional paints that override the batch's shared ones.
 *
 * @category Instancing
 */
export interface PathBatchItem {
	/** The outline flattened. Optional when `curvePaths` is given (it is flattened for picking). */
	polylines?: readonly Polyline[];
	/** Exact curves of the outline, drawn instead of `polylines` when given. */
	curvePaths?: readonly CurvePath[];
	/** Whether the outline is closed: only a closed outline is filled. */
	closed: boolean;
	/** This item's fill colour. Defaults to the batch's `fill`. */
	fill?: string;
	/** This item's stroke colour (`"none"` for none). Defaults to the batch's `stroke`. */
	stroke?: string;
	/** This item's stroke width, in the batch's units. Defaults to the batch's `strokeWidth`. */
	strokeWidth?: number;
	/** This item's opacity 0..1, on top of the batch's. @default 1 */
	opacity?: number;
	/**
	 * This item's arc-length reveal, 0..1, as `progress` is on a shape: its
	 * stroke traces along the outline (subpaths in order) and a closed
	 * outline's fill comes up with it. The batch's own `progress` stays the
	 * whole batch's fade. A closed `polylines` outline traces its closing
	 * edge only when its last point repeats its first (as shape outlines
	 * do). Keep the outline arrays the same from frame to frame while only
	 * this changes, so their arc lengths are measured once.
	 * @default 1
	 */
	progress?: number;
	/** This item's offset into the dash, in the batch's units. Defaults to the batch's `dashOffset`. */
	dashOffset?: number;
}

/**
 * What a path batch definition's `paths` returns: the items, in paint order.
 *
 * @category Instancing
 */
export interface PathBatchGeometry {
	items: readonly PathBatchItem[];
}

/**
 * Props shared by every item of a path batch: `MarksProps` plus a shared
 * fill.
 *
 * @category Instancing
 */
export interface PathBatchProps extends MarksProps {
	/** Fill colour of every closed item without its own. Defaults to none. */
	fill?: string;
	/** Dash pattern shared by every item's stroke, in the batch's units. Solid when omitted. */
	dash?: number[];
	/** Offset into `dash`, in the batch's units. @default 0 */
	dashOffset?: number;
	/** How open strokes end. @default "round" */
	lineCap?: CanvasLineCap;
	/** How stroke segments join. @default "round" */
	lineJoin?: CanvasLineJoin;
}

/**
 * Descriptor entries for every {@link PathBatchProps} key.
 *
 * @category Instancing
 */
export const pathBatchProps: PropsDescriptor<PathBatchProps> = Object.freeze({
	...marksProps,
	fill: { invalidates: Invalidate.STYLE },
	dash: { invalidates: Invalidate.STYLE },
	dashOffset: { invalidates: Invalidate.STYLE },
	lineCap: { invalidates: Invalidate.STYLE },
	lineJoin: { invalidates: Invalidate.STYLE },
});

/**
 * Options for {@link definePathBatch}.
 *
 * @typeParam P - The batch's props.
 *
 * @category Instancing
 */
export interface PathBatchOptions<P extends MarksProps> {
	/** PascalCase display and codegen name (`"PieWedges"`). */
	name: string;
	/** One entry per prop: `...pathBatchProps` (or `...marksProps`) plus the definition's own. */
	props: PropsDescriptor<P>;
	/**
	 * The items in the definition's own units, from the props it reads.
	 * Reruns when a prop invalidating `Invalidate.GEOMETRY` changes; hand back the
	 * same item objects (or new items around the same `polylines` /
	 * `curvePaths` arrays) for outlines that did not change, and their
	 * prepared forms are reused.
	 */
	paths: (props: Readonly<P>) => PathBatchGeometry;
}

/** One item's outline, prepared once: about its box centre, with its reach. */
interface PreparedItem {
	outline: MarkOutline;
	/** Its box centre, in the batch's units. */
	center: Point;
	/** Largest distance of any of its points (or control points) from `center`. */
	reach: number;
}

/** Prepared outlines by item object, so an unchanged item is prepared once. */
const preparedItems = new WeakMap<PathBatchItem, PreparedItem>();

/** A prepared outline with the geometry it was prepared from. */
interface PreparedSource {
	polylines: readonly Polyline[] | undefined;
	curvePaths: readonly CurvePath[] | undefined;
	closed: boolean;
	prepared: PreparedItem;
}

/**
 * Prepared outlines by geometry array (`curvePaths`, else `polylines`): a
 * new item object around the same outline (one whose `progress` or paint
 * changed) reuses the prepared outline, so its identity, and the arc-length
 * tables the renderer keys on it, hold across frames.
 */
const preparedGeometry = new WeakMap<object, PreparedSource>();

/** An item's outline about its box centre (cached on the item object and on its geometry). */
function prepareItem(item: PathBatchItem): PreparedItem {
	let prepared = preparedItems.get(item);
	if (prepared) return prepared;
	const geometry = item.curvePaths ?? item.polylines;
	const known = geometry ? preparedGeometry.get(geometry) : undefined;
	if (
		known &&
		known.polylines === item.polylines &&
		known.curvePaths === item.curvePaths &&
		known.closed === item.closed
	) {
		preparedItems.set(item, known.prepared);
		return known.prepared;
	}
	const curves = item.curvePaths;
	const lines =
		item.polylines ?? (curves ? flattenCurves(curves as CurvePath[]) : []);
	const hasPoints = lines.some((line) => line.length > 0);
	const center = hasPoints
		? centerOf(boundsOf(lines as Polyline[]))
		: { x: 0, y: 0 };
	const { x: cx, y: cy } = center;
	const polylines = lines.map((line) =>
		line.map((p) => ({ x: p.x - cx, y: p.y - cy })),
	);
	const back = translate(-cx, -cy);
	const curvePaths = curves
		? curves.map((path) => applyToCurvePath(back, path))
		: null;
	let reach2 = 0;
	const take = (p: Point) => {
		const r2 = p.x * p.x + p.y * p.y;
		if (r2 > reach2) reach2 = r2;
	};
	for (const line of polylines) for (const p of line) take(p);
	if (curvePaths) {
		for (const path of curvePaths) {
			take(path.start);
			for (const segment of path.segments) {
				take(segment.c1);
				take(segment.c2);
				take(segment.to);
			}
		}
	}
	prepared = {
		outline: { polylines, curvePaths, closed: item.closed },
		center,
		reach: Math.sqrt(reach2),
	};
	preparedItems.set(item, prepared);
	if (geometry) {
		preparedGeometry.set(geometry, {
			polylines: item.polylines,
			curvePaths: item.curvePaths,
			closed: item.closed,
			prepared,
		});
	}
	return prepared;
}

/** A batch's items prepared: the `paths` mark and each item's centre and reach. */
interface PreparedBatch {
	shape: MarkShape;
	centers: Float64Array;
	reaches: Float64Array;
}

function prepareBatch(source: PathBatchGeometry): PreparedBatch {
	const count = source.items.length;
	const outlines: MarkOutline[] = new Array(count);
	const centers = new Float64Array(count * 2);
	const reaches = new Float64Array(count);
	for (let i = 0; i < count; i++) {
		const prepared = prepareItem(source.items[i] as PathBatchItem);
		outlines[i] = prepared.outline;
		centers[2 * i] = prepared.center.x;
		centers[2 * i + 1] = prepared.center.y;
		reaches[i] = prepared.reach;
	}
	return { shape: { kind: "paths", outlines }, centers, reaches };
}

/** The placed batch: scene-unit centres, shared linear part, extents and box. */
interface PlacedBatch {
	centers: Float64Array;
	transforms: Float64Array | null;
	extents: Float64Array;
	bounds: Bounds | null;
}

/** The largest factor `m`'s linear part stretches any direction by. */
function largestStretch(m: Matrix): number {
	if (m.b === 0 && m.c === 0) return Math.max(Math.abs(m.a), Math.abs(m.d));
	const sum = m.a * m.a + m.b * m.b + m.c * m.c + m.d * m.d;
	const det = m.a * m.d - m.b * m.c;
	const root = Math.sqrt(Math.max(0, sum * sum - 4 * det * det));
	return Math.sqrt((sum + root) / 2);
}

function placeBatch(prepared: PreparedBatch, m: Matrix): PlacedBatch {
	const count = prepared.reaches.length;
	const identity =
		m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1 && m.e === 0 && m.f === 0;
	const linearIdentity = m.a === 1 && m.b === 0 && m.c === 0 && m.d === 1;
	let centers = prepared.centers;
	if (!identity) {
		centers = new Float64Array(count * 2);
		for (let i = 0; i < count; i++) {
			const x = prepared.centers[2 * i] as number;
			const y = prepared.centers[2 * i + 1] as number;
			centers[2 * i] = m.a * x + m.c * y + m.e;
			centers[2 * i + 1] = m.b * x + m.d * y + m.f;
		}
	}
	let transforms: Float64Array | null = null;
	if (!linearIdentity) {
		transforms = new Float64Array(count * 4);
		for (let i = 0; i < count; i++) {
			transforms[4 * i] = m.a;
			transforms[4 * i + 1] = m.b;
			transforms[4 * i + 2] = m.c;
			transforms[4 * i + 3] = m.d;
		}
	}
	const stretch = largestStretch(m);
	const extents = new Float64Array(count);
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (let i = 0; i < count; i++) {
		const reach = (prepared.reaches[i] as number) * stretch;
		extents[i] = reach;
		const x = centers[2 * i] as number;
		const y = centers[2 * i + 1] as number;
		if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
		if (x - reach < minX) minX = x - reach;
		if (x + reach > maxX) maxX = x + reach;
		if (y - reach < minY) minY = y - reach;
		if (y + reach > maxY) maxY = y + reach;
	}
	const bounds = minX <= maxX ? { minX, minY, maxX, maxY } : null;
	return { centers, transforms, extents, bounds };
}

/** The per-item paints: arrays only where some item has its own. */
interface BatchPaints {
	fills: readonly string[] | string;
	strokes: readonly string[] | null;
	strokeWidths: Float32Array | null;
	alphas: Float32Array | null;
	/** Each item's reveal; null when none is below 1. */
	progresses: Float32Array | null;
	/** Each item's dash offset in scene units; null when no item has its own. */
	dashOffsets: Float32Array | null;
	/** The widest stroke, in scene units (for the shared style). */
	widest: number;
	/** The first visible per-item stroke, for the shared style. */
	anyStroke: string | null;
}

function batchPaints(
	source: PathBatchGeometry,
	sharedFill: string,
	sharedStroke: PaintSpec,
	sharedWidth: number,
	sharedDashOffset: number,
	penScale: number,
): BatchPaints {
	const items = source.items;
	const count = items.length;
	let ownFill = false;
	let ownStroke = false;
	let ownWidth = false;
	let ownOpacity = false;
	let partial = false;
	let ownDashOffset = false;
	for (const item of items) {
		if (item.fill !== undefined) ownFill = true;
		if (item.stroke !== undefined) ownStroke = true;
		if (item.strokeWidth !== undefined) ownWidth = true;
		if (item.opacity !== undefined) ownOpacity = true;
		if (item.progress !== undefined && item.progress < 1) partial = true;
		if (item.dashOffset !== undefined) ownDashOffset = true;
	}
	const fills = ownFill
		? items.map((item) =>
				item.fill === undefined ? sharedFill : cssColor(item.fill),
			)
		: sharedFill;
	let anyStroke: string | null = null;
	let strokes: string[] | null = null;
	if (ownStroke) {
		if (isGradientSpec(sharedStroke)) {
			throw new Error(
				"pathBatch: items with their own stroke need a colour as the shared stroke, not a gradient.",
			);
		}
		const fallback = cssColor(sharedStroke as string);
		strokes = items.map((item) =>
			item.stroke === undefined ? fallback : cssColor(item.stroke),
		);
		anyStroke = strokes.find((stroke) => stroke !== "none") ?? null;
	}
	let strokeWidths: Float32Array | null = null;
	let widest = sharedWidth * penScale;
	if (ownWidth) {
		strokeWidths = new Float32Array(count);
		for (let i = 0; i < count; i++) {
			const width =
				((items[i] as PathBatchItem).strokeWidth ?? sharedWidth) * penScale;
			strokeWidths[i] = width;
			if (width > widest) widest = width;
		}
	}
	let alphas: Float32Array | null = null;
	if (ownOpacity) {
		alphas = new Float32Array(count);
		for (let i = 0; i < count; i++)
			alphas[i] = (items[i] as PathBatchItem).opacity ?? 1;
	}
	// Reveals only while some item is partly drawn, so a revealed batch
	// publishes exactly what it would without them.
	let progresses: Float32Array | null = null;
	if (partial) {
		progresses = new Float32Array(count);
		for (let i = 0; i < count; i++) {
			const progress = (items[i] as PathBatchItem).progress ?? 1;
			progresses[i] = progress < 1 ? Math.max(0, progress) : 1;
		}
	}
	// Dash offsets scale with the pen, as the shared one does.
	let dashOffsets: Float32Array | null = null;
	if (ownDashOffset) {
		dashOffsets = new Float32Array(count);
		for (let i = 0; i < count; i++) {
			dashOffsets[i] =
				((items[i] as PathBatchItem).dashOffset ?? sharedDashOffset) * penScale;
		}
	}
	return {
		fills,
		strokes,
		strokeWidths,
		alphas,
		progresses,
		dashOffsets,
		widest,
		anyStroke,
	};
}

/** The matching stages for a node that places through its space. */
function stagesForBatchSpace(change: number): InvalidateBits {
	let bits = 0;
	if (change & (SpaceChange.MATRIX | SpaceChange.PEN_SCALE))
		bits |= Invalidate.TRANSFORM;
	if (change & SpaceChange.OPACITY) bits |= Invalidate.STYLE;
	if (change & SpaceChange.CLIP) bits |= Invalidate.SPEC;
	return bits;
}

/**
 * A path batch node: every item of a batch as one node. Made by a
 * {@link definePathBatch} definition's `create`.
 *
 * @typeParam P - The batch's props.
 *
 * @category Instancing
 */
export class PathBatchNode<
	P extends MarksProps = PathBatchProps,
> extends BaseNode<P> {
	override readonly producesSpec = true;

	private readonly options: PathBatchOptions<P>;
	/** The items in their own units, or null when a geometry prop changed since. */
	private source: PathBatchGeometry | null = null;
	/** The shared style and paints, or null when a style prop (or the theme) changed since. */
	private styled: { style: StrokeStyle; paints: BatchPaints } | null = null;
	private styledScale = Number.NaN;
	private styledBounds: Bounds | null = null;

	private readonly prepared = memo(prepareBatch);
	private readonly placed = memo(placeBatch);
	private readonly specOf = memo(
		(
			prepared: PreparedBatch,
			placed: PlacedBatch,
			style: StrokeStyle,
			paints: BatchPaints,
			progress: number,
			zIndex: number,
			clip: readonly ClipRegion[] | undefined,
		): MarksSpec => ({
			kind: "marks",
			id: this.id,
			zIndex,
			shape: prepared.shape,
			count: prepared.reaches.length,
			centers: placed.centers,
			extents: placed.extents,
			fills: paints.fills,
			alphas: paints.alphas,
			style,
			progress,
			bounds: placed.bounds,
			clip,
			transforms: placed.transforms,
			strokes: paints.strokes,
			strokeWidths: paints.strokeWidths,
			// Only when present, so a batch without them keeps its exact spec.
			...(paints.progresses ? { progresses: paints.progresses } : null),
			...(paints.dashOffsets ? { dashOffsets: paints.dashOffsets } : null),
		}),
	);
	private readonly localBox = memo((source: PathBatchGeometry): Polyline[] => {
		const placed = placeBatch(prepareBatch(source), IDENTITY);
		const box = placed.bounds;
		if (!box) return [];
		return [
			[
				{ x: box.minX, y: box.minY },
				{ x: box.maxX, y: box.minY },
				{ x: box.maxX, y: box.maxY },
				{ x: box.minX, y: box.maxY },
			],
		];
	});

	constructor(definition: Definition<P>, options: PathBatchOptions<P>) {
		super(definition);
		this.options = options;
	}

	protected run(dirty: InvalidateBits): void {
		if (dirty & Invalidate.GEOMETRY) {
			this.source = null;
			this.styled = null;
		}
		if (dirty & Invalidate.STYLE) this.styled = null;
		this.publish(this.assemble());
	}

	protected override stagesForSpace(change: number): InvalidateBits {
		return stagesForBatchSpace(change);
	}

	protected override stagesForContext(
		key: ContextKey<unknown>,
	): InvalidateBits {
		return key === themeContext || key === ANY_CONTEXT ? Invalidate.STYLE : 0;
	}

	private currentSource(): PathBatchGeometry {
		this.source ??= this.options.paths(this.props);
		return this.source;
	}

	private assemble(): MarksSpec | null {
		const props = this.props;
		if (props.visible === false) return null;
		const source = this.currentSource();
		if (source.items.length === 0) return null;
		const space = this.space;
		const prepared = this.prepared(source);
		const placed = this.placed(prepared, space.matrix);
		const { style, paints } = this.currentStyle(source, placed.bounds);
		return this.specOf(
			prepared,
			placed,
			style,
			paints,
			Math.min(1, Math.max(0, props.progress ?? 1)),
			props.zIndex ?? 0,
			space.clip,
		);
	}

	/** The shared style and per-item paints, rebuilt when their props, the pen scale or (for a gradient) the box changed. */
	private currentStyle(
		source: PathBatchGeometry,
		bounds: Bounds | null,
	): { style: StrokeStyle; paints: BatchPaints } {
		const props = this.props;
		const space = this.space;
		const scale = space.penScale ?? scaleFactorOf(space.matrix);
		const stroke = props.stroke ?? "none";
		const gradient = isGradientSpec(stroke);
		if (
			this.styled &&
			scale === this.styledScale &&
			(!gradient || bounds === this.styledBounds)
		)
			return this.styled;
		this.styledScale = scale;
		this.styledBounds = bounds;
		const theme: Theme = this.context(themeContext);
		const sharedWidth = props.strokeWidth ?? theme.defaults.strokeWidth;
		const fill = (props as PathBatchProps).fill;
		const paints = batchPaints(
			source,
			fill === undefined ? "none" : cssColor(fill),
			stroke,
			sharedWidth,
			(props as PathBatchProps).dashOffset ?? 0,
			scale,
		);
		const style = bakeStrokeStyle(
			{
				stroke: paints.anyStroke ?? stroke,
				strokeWidth: props.strokeWidth,
				opacity: props.opacity,
				fillOpacity: props.fillOpacity,
				fill: undefined,
				dash: (props as PathBatchProps).dash,
				dashOffset: (props as PathBatchProps).dashOffset,
				lineCap: (props as PathBatchProps).lineCap,
				lineJoin: (props as PathBatchProps).lineJoin,
			},
			theme,
			scale,
			space.opacity,
			// A shared gradient stroke spans the batch's box, in scene units.
			() => ({
				box: bounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 },
				toScene: (at) => at,
				sceneUnitsPerUnit: 1,
			}),
		);
		if (paints.strokeWidths) style.strokeWidth = paints.widest;
		this.styled = { style, paints };
		return this.styled;
	}

	/** The items' box in the batch's own units, strokes excluded. */
	protected override localOutline(): readonly Polyline[] | null {
		return this.localBox(this.currentSource());
	}
}

/**
 * Makes a path batch definition: one node drawing every outline
 * `paths(props)` returns, in order, mapped through the enclosing space.
 * Handlers get the item under the pointer as `event.item`.
 *
 * @example
 * ```ts
 * import { definePathBatch, pathBatchProps, type PathBatchProps, Invalidate } from "@sophistry/core";
 *
 * interface StripesProps extends PathBatchProps {
 * 	count: number;
 * }
 *
 * export const stripes = definePathBatch<StripesProps>({
 * 	name: "Stripes",
 * 	props: { ...pathBatchProps, count: { default: 3, invalidates: Invalidate.GEOMETRY } },
 * 	paths: (props) => ({
 * 		items: Array.from({ length: props.count }, (_, i) => ({
 * 			closed: true,
 * 			polylines: [[{ x: i, y: 0 }, { x: i + 0.5, y: 0 }, { x: i + 0.5, y: 2 }, { x: i, y: 2 }]],
 * 			fill: i % 2 ? "tomato" : "teal",
 * 		})),
 * 	}),
 * });
 * ```
 *
 * @param options - See {@link PathBatchOptions}.
 * @returns The definition; `create(props)` makes a {@link PathBatchNode}.
 * @category Instancing
 */
export function definePathBatch<P extends MarksProps>(
	options: PathBatchOptions<P>,
): Definition<P, PathBatchNode<P>> {
	return definePrimitive<P, PathBatchNode<P>>({
		name: options.name,
		props: options.props,
		node: (definition) => new PathBatchNode<P>(definition, options),
	});
}

/**
 * Props of {@link pathBatch}: the items themselves, plus the shared props.
 *
 * @category Instancing
 */
export interface PathBatchItemsProps extends PathBatchProps {
	/** The outlines, in paint order. */
	items: readonly PathBatchItem[];
}

/**
 * A ready-made path batch: draws the `items` it is given. What charts use
 * for pie wedges, ribbons, areas and multi-line series.
 *
 * @example
 * ```ts
 * import { createScene, pathBatch } from "@sophistry/core";
 *
 * const triangleA = [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1.5 }];
 * const triangleB = [{ x: 0, y: 0 }, { x: 1, y: 1.5 }, { x: -1, y: 1.5 }];
 *
 * const scene = createScene({ host: document.body });
 * const wedges = pathBatch.create({
 * 	items: [
 * 		{ closed: true, polylines: [triangleA], fill: "tomato" },
 * 		{ closed: true, polylines: [triangleB], fill: "teal" },
 * 	],
 * 	stroke: "white",
 * 	onTap: (event) => console.log("wedge", event.item),
 * });
 * scene.root.add(wedges);
 * ```
 *
 * @category Instancing
 */
export const pathBatch: Definition<
	PathBatchItemsProps,
	PathBatchNode<PathBatchItemsProps>
> = definePathBatch<PathBatchItemsProps>({
	name: "PathBatch",
	props: {
		...pathBatchProps,
		items: { default: [], invalidates: Invalidate.GEOMETRY },
	},
	paths: (props) => ({ items: props.items ?? [] }),
});
