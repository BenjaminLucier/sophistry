/**
 * `networkGraph` and `diGraph`: Manim's `Graph` and `DiGraph` (the function
 * plotter is `functionGraph`).
 *
 * Every vertex and edge is its own node, so one part can be styled, animated
 * or measured: `vertexConfigs`/`edgeConfigs` restyle single parts, and
 * {@link networkHandle} hands back each part's node for layout helpers.
 * Positions are a cached function of `layout`, so changing layout is blending
 * two maps. Drawn counts are capped (`MAX_VERTICES`).
 *
 * The graph is a composite: a write to any prop but `progress` rebuilds the
 * parts it affects (kept by vertex id and edge key, so a restyle is a few
 * prop writes, never new nodes), and the layout is only re-run when the
 * vertices, edges or layout options change. `progress` is split into two
 * phases bound straight to the parts, so a reveal never reaches `update`.
 */

import type { ColorInput } from "../color/index.js";
import type {
	GraphData,
	GraphEdge,
	GraphExtent,
	GraphLayoutOptions,
	GraphLayoutSpec,
	Point,
	TipShape,
	VertexId,
} from "../geometry/index.js";
import {
	edgeKey,
	resolveGraphLayout,
	scaleFactorOf,
} from "../geometry/index.js";
import { progressIn } from "../geometry/lerp.js";
import type { Readable } from "../reactive/index.js";
import { derive } from "../reactive/index.js";
import type { CompositeContext } from "../scene/composite.js";
import { defineComposite } from "../scene/composite.js";
import { Invalidate } from "../scene/context.js";
import { label } from "../scene/text.js";
import type { SceneNode } from "../scene/types.js";
import { SpaceChange } from "../scene/types.js";
import { circle } from "../shapes/circle.js";
import { LABELED_DOT_FONT_SIZE, labeledDotRadius } from "../shapes/dot.js";
import { arrow, line } from "../shapes/line.js";
import type { PaintSpec } from "../spec/gradient.js";
import type { Theme } from "../themes/types.js";

/**
 * Drawn-vertex cap. Past it the first `MAX_VERTICES` declared vertices are drawn
 * and edges touching the rest dropped; layout still positions every vertex.
 */
const MAX_VERTICES = 400;
/**
 * Drawn-edge cap. Thinned by stride rather than truncated, since edge order is
 * rarely meaningful and a sparse sample of a dense graph at least still shows
 * where the density is.
 */
const MAX_EDGES = 1500;

/** Vertices, then edges — a network reads as "the things, then the links". */
const PHASES = 2;
const DEFAULT_VERTEX_RADIUS = 0.16;
/** Clearance between an edge's end and the disc it points at, in scene units. */
const DEFAULT_EDGE_GAP = 0.02;
const DEFAULT_EDGE_STROKE_WIDTH = 0.028;
const DEFAULT_TIP_LENGTH = 0.22;
const DEFAULT_EDGE_LABEL_FONT_SIZE = 0.24;
const DEFAULT_EDGE_LABEL_OFFSET = 0.14;

/**
 * One vertex's appearance. Merged over `vertexConfig`, so a scene names only
 * what differs.
 *
 * @category Coordinate systems & graphs
 */
export interface VertexConfig {
	/** Disc fill. Defaults to the theme accent. */
	color?: ColorInput;
	/** Outline colour or gradient. Defaults to `color`. */
	stroke?: PaintSpec;
	/**
	 * Outline width. No outline by default.
	 * @default 0
	 */
	strokeWidth?: number;
	/**
	 * Scene-unit radius. A *floor* when the vertex is labelled, as `labeledDot`.
	 * @default 0.16
	 */
	radius?: number;
	/** Opacity, 0..1. */
	opacity?: number;
	/**
	 * Local scale about the vertex — what `indicate` drives.
	 * @default 1
	 */
	scale?: number;
	/** Paint order; falls back to the graph's `zIndex`. */
	zIndex?: number;
	/** Falls back to the graph's `visible`. */
	visible?: boolean;
	/** Overrides whatever `labels` derived for this vertex. */
	label?: string;
	/** Label colour. Defaults to the theme background, to read on the filled disc. */
	labelColor?: ColorInput;
	/** Label font size, before `scale`. Defaults to the `labeledDot` size. */
	fontSize?: number;
}

/**
 * One edge's appearance. Merged over `edgeConfig`.
 *
 * @category Coordinate systems & graphs
 */
export interface EdgeConfig {
	/** Line colour or gradient. Defaults to the theme's muted colour. */
	stroke?: PaintSpec;
	/**
	 * Line width.
	 * @default 0.028
	 */
	strokeWidth?: number;
	/** Opacity, 0..1. */
	opacity?: number;
	/** Dash pattern in scene units. */
	dash?: number[];
	/** Offset into the dash pattern, in scene units. */
	dashOffset?: number;
	/** Paint order; falls back to the graph's `zIndex`. */
	zIndex?: number;
	/** Falls back to the graph's `visible`. */
	visible?: boolean;
	/** Arc-length reveal for this edge alone, on top of the graph's `progress`. */
	progress?: number;
	/** Drawn at the edge's midpoint, offset clear of the line. A weight, usually. */
	label?: string;
	/** Edge label colour. Defaults to the theme's muted colour. */
	labelColor?: ColorInput;
	/**
	 * Edge label font size.
	 * @default 0.24
	 */
	labelFontSize?: number;
	/**
	 * Arrow tip shape. Directed graphs only. Defaults to the graph's `tipShape`, else `"triangle"`.
	 */
	tipShape?: TipShape;
	/**
	 * Arrow tip length. Directed graphs only.
	 * @default 0.22
	 */
	tipLength?: number;
	/**
	 * Extra clearance beyond the vertex radius at each end.
	 * @default 0.02
	 */
	gap?: number;
}

/**
 * An edge as the caller may write it: Manim's `[source, target]` tuple, or a `{ source, target }` object (which can also carry a weight).
 *
 * @category Coordinate systems & graphs
 */
export type EdgeSpec = GraphEdge | readonly [VertexId, VertexId];

/**
 * Per-vertex data, keyed by `String(vertexId)` in a plain object, or by the id itself in a `Map`.
 *
 * @category Coordinate systems & graphs
 */
export type VertexMap<T> =
	| Readonly<Record<string, T>>
	| ReadonlyMap<VertexId, T>;
/**
 * Per-edge data, keyed by the {@link edgeKey} string in a plain object, or by that same string in a `Map`.
 *
 * @category Coordinate systems & graphs
 */
export type EdgeMap<T> = Readonly<Record<string, T>> | ReadonlyMap<string, T>;

/**
 * The addressable half of a graph node, made by {@link networkHandle}. Reads
 * the graph's current state on every call.
 *
 * @category Coordinate systems & graphs
 */
export interface NetworkGraphHandle {
	/** Every declared vertex, including any implied by an edge. */
	vertexIds(): VertexId[];
	/** `edgeKey(source, target)` for every edge, in declaration order. */
	edgeKeys(): string[];
	/** Layout position in scene units, for every vertex — drawn or capped out. */
	positions(): Map<VertexId, Point>;
	/** One vertex's layout position in scene units, or null if the id is unknown. */
	positionOf(id: VertexId): Point | null;
	/** The disc's radius in scene units — what the edges are trimmed to. */
	radiusOf(id: VertexId): number;
	/**
	 * One vertex's node (its disc, or what `renderVertex` returned):
	 * `bounds()` for a surrounding rectangle, `center()` for `nextTo`.
	 * Undefined before the graph's first commit, and for a vertex past the
	 * drawing cap.
	 */
	vertexHandle(id: VertexId): SceneNode | undefined;
	/** One edge's node, or undefined before it exists (or if it is not drawn). Undirected graphs match either direction. */
	edgeHandle(source: VertexId, target: VertexId): SceneNode | undefined;
}

/**
 * What `renderVertex` is handed.
 *
 * @category Coordinate systems & graphs
 */
export interface VertexRender {
	id: VertexId;
	/** Centre in scene units. */
	at: Point;
	/** Disc radius in scene units; edges are trimmed to this. */
	radius: number;
	/** The merged `vertexConfig` and per-vertex override. */
	config: VertexConfig;
	/** Label text, if the vertex has one. */
	label: string | undefined;
	/** Reveal amount for this vertex, 0..1: bind the node's `progress` to it. */
	progress: Readable<number>;
}

/**
 * What `renderEdge` is handed. `from`/`to` are already trimmed to the discs.
 *
 * @category Coordinate systems & graphs
 */
export interface EdgeRender {
	/** The {@link edgeKey} for this edge. */
	key: string;
	source: VertexId;
	target: VertexId;
	/** Start point in scene units, already trimmed to the source disc. */
	from: Point;
	/** End point in scene units, already trimmed to the target disc. */
	to: Point;
	/** The merged `edgeConfig` and per-edge override. */
	config: EdgeConfig;
	/** Whether the graph is directed (draw a tip). */
	directed: boolean;
	/** Reveal amount for this edge, 0..1: bind the node's `progress` to it. */
	progress: Readable<number>;
}

/**
 * Props for {@link networkGraph} and {@link diGraph}.
 *
 * @category Coordinate systems & graphs
 */
export interface NetworkGraphProps {
	/** Vertex ids (strings or numbers), in declaration order. An id used only in an edge is added implicitly. At most 400 are drawn. */
	vertices: readonly VertexId[];
	/** Edges as `[source, target]` tuples or `{ source, target }` objects. At most 1500 are drawn; extras are thinned evenly. */
	edges: readonly EdgeSpec[];
	/**
	 * A name from `graphLayouts`, or your own pure function.
	 * @default "spring"
	 */
	layout?: GraphLayoutSpec;
	/** Everything the layout takes. `layoutScale` and `center` are sugar over it. */
	layoutOptions?: GraphLayoutOptions;
	/** Scene-unit box the layout is fitted into. Defaults to a square of side 4. */
	layoutScale?: GraphExtent;
	/** Centre of that box. Defaults to the scene origin. */
	center?: Point;
	/** `true` labels every vertex with its own id; a map labels the named ones. */
	labels?: boolean | VertexMap<string>;
	/** Shared vertex appearance. */
	vertexConfig?: VertexConfig;
	/** Per-vertex overrides, merged over `vertexConfig`. */
	vertexConfigs?: VertexMap<VertexConfig>;
	/** Shared edge appearance. */
	edgeConfig?: EdgeConfig;
	/** Per-edge overrides. Keyed by `edgeKey(u, v)`; undirected tries both ways. */
	edgeConfigs?: EdgeMap<EdgeConfig>;
	/** Set by {@link diGraph}. Draws arrow tips and stops treating `(u,v)` as `(v,u)`. */
	directed?: boolean;
	/** Default tip shape for a directed graph. */
	tipShape?: TipShape;
	/**
	 * Draw a vertex however you like — Manim's `vertex_type`/`vertex_mobjects`.
	 * Called whenever the vertex's render data changes, with the node it
	 * returned last time (undefined the first time): update and return that
	 * node to keep it, or return a new one (the old one is disposed).
	 */
	renderVertex?: (
		vertex: VertexRender,
		previous: SceneNode | undefined,
	) => SceneNode;
	/** Draw an edge however you like. Receives trimmed endpoints; called as `renderVertex` is. */
	renderEdge?: (edge: EdgeRender, previous: SceneNode | undefined) => SceneNode;
	/**
	 * Reveal amount, 0..1: vertices first, then edges.
	 * @default 1
	 */
	progress?: number;
	/** Default paint order for vertices and edges (a part's own `zIndex` wins). */
	zIndex?: number;
	/** Default visibility for vertices and edges (a part's own `visible` wins). */
	visible?: boolean;
	/** Placed after the graph, so annotations paint over it. */
	children?: readonly SceneNode[];
}

function lookup<T>(map: VertexMap<T> | undefined, id: VertexId): T | undefined {
	if (!map) return undefined;
	if (map instanceof Map) return map.get(id);
	return (map as Record<string, T>)[String(id)];
}

function lookupEdge<T>(
	map: EdgeMap<T> | undefined,
	key: string,
): T | undefined {
	if (!map) return undefined;
	if (map instanceof Map) return map.get(key);
	return (map as Record<string, T>)[key];
}

function asEdge(spec: EdgeSpec): GraphEdge {
	return Array.isArray(spec)
		? { source: spec[0], target: spec[1] }
		: (spec as GraphEdge);
}

/** Keeps every k-th, as `numberPlane` thins its grid. */
function everyNth<T>(values: T[], limit: number): T[] {
	if (values.length <= limit) return values;
	const stride = Math.ceil(values.length / limit);
	return values.filter((_, index) => index % stride === 0);
}

/** An edge as drawn: trimmed to the discs, with its merged config. */
interface DrawnEdge {
	key: string;
	source: VertexId;
	target: VertexId;
	from: Point;
	to: Point;
	config: EdgeConfig;
}

/** What one build of a graph knows, kept for {@link networkHandle}. */
interface GraphState {
	/** Edge list, graph data, options and positions, each behind a last-input cache. */
	edgeList: (edges: readonly EdgeSpec[]) => GraphEdge[];
	graph: (
		vertices: readonly VertexId[],
		edges: GraphEdge[],
		directed: boolean | undefined,
	) => GraphData;
	options: (
		layoutOptions: GraphLayoutOptions | undefined,
		layoutScale: GraphExtent | undefined,
		center: Point | undefined,
	) => GraphLayoutOptions;
	positions: (
		layout: GraphLayoutSpec | undefined,
		graph: GraphData,
		options: GraphLayoutOptions,
	) => Map<VertexId, Point>;
	phase: (index: number) => Readable<number>;
	/** The latest build's results. */
	current: {
		edges: GraphEdge[];
		positions: Map<VertexId, Point>;
		radii: Map<VertexId, number>;
		directed: boolean;
	} | null;
	vertexNodes: Map<VertexId, SceneNode>;
	edgeNodes: Map<string, SceneNode>;
	customVertices: Map<VertexId, SceneNode>;
	customEdges: Map<string, SceneNode>;
}

const states = new WeakMap<SceneNode, GraphState>();

function createState(ctx: CompositeContext<NetworkGraphProps>): GraphState {
	return {
		edgeList: ctx.memo((edges: readonly EdgeSpec[]) => edges.map(asEdge)),
		graph: ctx.memo(
			(
				vertices: readonly VertexId[],
				edges: GraphEdge[],
				directed: boolean | undefined,
			): GraphData => ({ vertices, edges, directed }),
		),
		options: ctx.memo(
			(
				layoutOptions: GraphLayoutOptions | undefined,
				layoutScale: GraphExtent | undefined,
				center: Point | undefined,
			): GraphLayoutOptions => ({
				...layoutOptions,
				scale: layoutScale ?? layoutOptions?.scale,
				center: center ?? layoutOptions?.center,
			}),
		),
		positions: ctx.memo(
			(
				layout: GraphLayoutSpec | undefined,
				graph: GraphData,
				options: GraphLayoutOptions,
			) => resolveGraphLayout(layout)(graph, options),
		),
		phase: createPhases(ctx.prop("progress"), PHASES),
		current: null,
		vertexNodes: new Map(),
		edgeNodes: new Map(),
		customVertices: new Map(),
		customEdges: new Map(),
	};
}

/**
 * The graph's `progress` split into consecutive phases, each a `Readable`
 * the parts bind to (coords' `createPhases`, which `network/` may not import):
 * phase `index` is `clamp(progress * count - index)`.
 */
function createPhases(
	progress: Readable<number | undefined>,
	count: number,
): (index: number) => Readable<number> {
	const phases: Readable<number>[] = [];
	return (index) => {
		phases[index] ??= derive(progress, (value) =>
			// In phase-lengths, so a phase boundary is exact rather than a rounded share.
			progressIn((value ?? 1) * count, index, index + 1),
		);
		return phases[index] as Readable<number>;
	};
}

/** Perpendicular offset, so a weight doesn't sit on top of its own edge. */
function edgeLabelAt(from: Point, to: Point): Point {
	const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
	const offset = DEFAULT_EDGE_LABEL_OFFSET;
	return {
		x: (from.x + to.x) / 2 - ((to.y - from.y) / length) * offset,
		y: (from.y + to.y) / 2 + ((to.x - from.x) / length) * offset,
	};
}

/**
 * Builds every part for the current props; reuses kept nodes by id and key.
 * `directedByDefault` is what an unset `directed` means (true for `diGraph`).
 */
function buildGraph(
	ctx: CompositeContext<NetworkGraphProps>,
	directedByDefault: boolean,
): SceneNode[] {
	const props = ctx.props;
	const directed = props.directed ?? directedByDefault;
	const theme: Theme = ctx.theme;
	let state = states.get(ctx.node);
	if (!state) {
		state = createState(ctx);
		states.set(ctx.node, state);
	}

	const edgeList = state.edgeList(props.edges);
	// The layout gets `props.directed` as given (unset stays unset).
	const graph = state.graph(
		props.vertices,
		edgeList,
		directedByDefault ? directed : props.directed,
	);
	const options = state.options(
		props.layoutOptions,
		props.layoutScale,
		props.center,
	);
	const positions = state.positions(props.layout, graph, options);

	/** Every id the layout knows about — declared or implied by an edge. */
	const allIds = [...positions.keys()];
	const drawnIds = allIds.slice(0, MAX_VERTICES);
	const drawable = new Set<VertexId>(drawnIds);

	const configOf = (id: VertexId): VertexConfig => ({
		...props.vertexConfig,
		...lookup(props.vertexConfigs, id),
	});

	const labelOf = (id: VertexId): string | undefined => {
		const override = configOf(id).label;
		if (override !== undefined) return override;
		const labels = props.labels;
		if (labels === undefined || labels === false) return undefined;
		if (labels === true) return String(id);
		return lookup(labels, id);
	};

	/**
	 * The disc's radius, measured rather than assumed — a labelled vertex grows
	 * to fit its text, and an arrowhead aimed at a radius that is only *roughly*
	 * right is the classic version of this bug. Measured once per vertex per
	 * build: every edge asks for both of its endpoints.
	 */
	// A tracked read of the space, made only when a vertex has text to measure:
	// the graph then rebuilds when an ancestor zooms, as a labelled vertex's
	// size is in pixels; an unlabelled graph never does.
	const perUnit = () => scaleFactorOf(ctx.space(SpaceChange.MATRIX).matrix);
	const fontFamily = theme.defaults.fontFamily;
	const radii = new Map<VertexId, number>(
		allIds.map((id) => {
			const config = configOf(id);
			const text = labelOf(id);
			const floor = config.radius ?? DEFAULT_VERTEX_RADIUS;
			return [
				id,
				text === undefined
					? floor
					: labeledDotRadius(
							text,
							{ ...config, minRadius: floor },
							perUnit(),
							fontFamily,
						),
			];
		}),
	);
	const radiusOf = (id: VertexId): number =>
		radii.get(id) ?? DEFAULT_VERTEX_RADIUS;

	const edgeConfigOf = (source: VertexId, target: VertexId): EdgeConfig => {
		const direct = lookupEdge(props.edgeConfigs, edgeKey(source, target));
		const reverse = directed
			? undefined
			: lookupEdge(props.edgeConfigs, edgeKey(target, source));
		return { ...props.edgeConfig, ...(direct ?? reverse) };
	};

	/**
	 * Edges as segments, each shortened to the boundary of the discs it joins.
	 *
	 * Centre-to-centre is what Manim draws, and it works there because the dot
	 * covers the overrun. It does not work for a directed graph: the arrowhead
	 * ends up *inside* the target disc, which reads as a line with no head at
	 * all. Trimming both ends also keeps a translucent vertex from showing the
	 * line running through it.
	 */
	const drawnEdges: DrawnEdge[] = [];
	const seen = new Set<string>();
	for (const edge of everyNth(
		edgeList.filter(
			(edge) => drawable.has(edge.source) && drawable.has(edge.target),
		),
		MAX_EDGES,
	)) {
		const from = positions.get(edge.source);
		const to = positions.get(edge.target);
		if (!from || !to) continue;
		const dx = to.x - from.x;
		const dy = to.y - from.y;
		const length = Math.hypot(dx, dy);
		// A self-loop, or two vertices the layout put on top of each other.
		// There is no honest segment to draw, and drawing one means `NaN`.
		if (!(length > 0)) continue;

		const config = edgeConfigOf(edge.source, edge.target);
		const gap = config.gap ?? DEFAULT_EDGE_GAP;
		const head = radiusOf(edge.source) + gap;
		const tail = radiusOf(edge.target) + gap;
		if (head + tail >= length) continue;

		const ux = dx / length;
		const uy = dy / length;
		// Duplicate pairs would stack two identical nodes under one key; the
		// first one wins.
		const key = edgeKey(edge.source, edge.target);
		if (seen.has(key)) continue;
		seen.add(key);

		drawnEdges.push({
			key,
			source: edge.source,
			target: edge.target,
			from: { x: from.x + ux * head, y: from.y + uy * head },
			to: { x: to.x - ux * tail, y: to.y - uy * tail },
			config,
		});
	}

	state.current = { edges: edgeList, positions, radii, directed };
	const vertexProgress = state.phase(0);
	const edgePhase = state.phase(1);

	/* Edges. */
	const children: SceneNode[] = [];
	const edgeNodes = new Map<string, SceneNode>();
	const customEdges = new Map<string, SceneNode>();
	const edgeShapes = ctx.list("edges", props.renderEdge ? [] : drawnEdges, {
		// The kind is part of the key: a graph turning directed swaps lines for arrows.
		key: (edge) => `${edge.key}|${directed}`,
		create: (edge) =>
			(directed ? arrow : line).create({ from: edge.from, to: edge.to }),
	});
	const edgeLabels = ctx.list(
		"edgeLabels",
		props.renderEdge
			? []
			: drawnEdges.filter((edge) => edge.config.label !== undefined),
		{ key: (edge) => edge.key, create: () => label.create({ text: "" }) },
	);
	let labelIndex = 0;
	for (let i = 0; i < drawnEdges.length; i++) {
		const edge = drawnEdges[i] as DrawnEdge;
		const config = edge.config;
		const progress =
			config.progress === undefined
				? edgePhase
				: derive(edgePhase, (phase) => Math.min(phase, config.progress ?? 1));
		if (props.renderEdge) {
			const previous = state.customEdges.get(edge.key);
			const node = props.renderEdge(
				{
					key: edge.key,
					source: edge.source,
					target: edge.target,
					from: edge.from,
					to: edge.to,
					config,
					directed,
					progress,
				},
				previous,
			);
			customEdges.set(edge.key, node);
			edgeNodes.set(edge.key, node);
			children.push(node);
			continue;
		}
		const shape = edgeShapes[i] as SceneNode<Record<string, unknown>>;
		shape.update({
			from: edge.from,
			to: edge.to,
			stroke: config.stroke ?? theme.palette.muted,
			strokeWidth: config.strokeWidth ?? DEFAULT_EDGE_STROKE_WIDTH,
			opacity: config.opacity,
			dash: config.dash,
			dashOffset: config.dashOffset,
			progress,
			zIndex: config.zIndex ?? props.zIndex,
			visible: config.visible ?? props.visible,
		});
		if (directed) {
			shape.update({
				tipShape: config.tipShape ?? props.tipShape ?? "triangle",
				tipLength: config.tipLength ?? DEFAULT_TIP_LENGTH,
			});
		}
		edgeNodes.set(edge.key, shape);
		children.push(shape);
		if (config.label !== undefined) {
			const caption = edgeLabels[labelIndex++] as SceneNode<
				Record<string, unknown>
			>;
			const at = edgeLabelAt(edge.from, edge.to);
			caption.update({
				text: config.label,
				x: at.x,
				y: at.y,
				fontSize: config.labelFontSize ?? DEFAULT_EDGE_LABEL_FONT_SIZE,
				color: config.labelColor ?? theme.palette.muted,
				opacity: config.opacity,
				progress,
				zIndex: config.zIndex ?? props.zIndex,
				visible: config.visible ?? props.visible,
			});
			children.push(caption);
		}
	}

	/* Vertices. */
	const vertexNodes = new Map<VertexId, SceneNode>();
	const customVertices = new Map<VertexId, SceneNode>();
	const labelled = props.renderVertex
		? []
		: drawnIds.filter((id) => labelOf(id) !== undefined);
	const discs = ctx.list("vertices", props.renderVertex ? [] : drawnIds, {
		create: () => circle.create({ radius: DEFAULT_VERTEX_RADIUS }),
	});
	const vertexLabels = ctx.list("vertexLabels", labelled, {
		create: () => label.create({ text: "" }),
	});
	labelIndex = 0;
	for (let i = 0; i < drawnIds.length; i++) {
		const id = drawnIds[i] as VertexId;
		const at = positions.get(id) ?? { x: 0, y: 0 };
		const config = configOf(id);
		const text = labelOf(id);
		if (props.renderVertex) {
			const node = props.renderVertex(
				{
					id,
					at,
					radius: radiusOf(id),
					config,
					label: text,
					progress: vertexProgress,
				},
				state.customVertices.get(id),
			);
			customVertices.set(id, node);
			vertexNodes.set(id, node);
			children.push(node);
			continue;
		}
		// One vertex: a disc, and its label as a second node. Not `labeledDot`,
		// which would compute its own radius and leave the edge trimming
		// guessing at it: the graph decides the radius and hands it down, so
		// the disc an arrowhead stops at is the disc that gets drawn.
		const color = config.color ?? theme.palette.accent;
		const disc = discs[i] as SceneNode<Record<string, unknown>>;
		disc.update({
			center: at,
			radius: radiusOf(id),
			fill: color,
			stroke: config.stroke ?? color,
			strokeWidth: config.strokeWidth ?? 0,
			opacity: config.opacity,
			scale: config.scale,
			origin: at,
			progress: vertexProgress,
			zIndex: config.zIndex ?? props.zIndex,
			visible: config.visible ?? props.visible,
		});
		vertexNodes.set(id, disc);
		children.push(disc);
		if (text !== undefined) {
			const caption = vertexLabels[labelIndex++] as SceneNode<
				Record<string, unknown>
			>;
			caption.update({
				text,
				// The disc's `scale` is a transform on the disc alone, so the text
				// has to be scaled about the same origin by hand. Doing it here is
				// what makes `indicate` on one vertex swell the number with it.
				x: at.x,
				y: at.y,
				fontSize:
					(config.fontSize ?? LABELED_DOT_FONT_SIZE) * (config.scale ?? 1),
				color: config.labelColor ?? theme.palette.background,
				opacity: config.opacity,
				progress: vertexProgress,
				zIndex: config.zIndex ?? props.zIndex,
				visible: config.visible ?? props.visible,
			});
			children.push(caption);
		}
	}

	state.vertexNodes = vertexNodes;
	state.edgeNodes = edgeNodes;
	state.customVertices = customVertices;
	state.customEdges = customEdges;
	return [...children, ...ctx.children];
}

/**
 * A network of vertices and edges (Manim's `Graph`). `layout` is a pure
 * function of `vertices` and `edges` (`"spring"` by default, or `"tree"`,
 * `"circular"`, `"grid"`, `"shell"`, `"partite"`, `"explicit"`, or your own),
 * fitted into `layoutScale` (default 4) around `center`. Per-vertex and
 * per-edge configs restyle single parts; key edges with {@link edgeKey}.
 * Self-loops are not drawn.
 *
 * @example
 * ```ts
 * import { createScene, networkGraph } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(
 * 	networkGraph.create({
 * 		vertices: [1, 2, 3, 4],
 * 		edges: [[1, 2], [2, 3], [3, 4], [4, 1]],
 * 		layout: "circular",
 * 		labels: true,
 * 	}),
 * );
 * ```
 *
 * @see {@link diGraph}
 * @see {@link https://sophistry.dev/guides/fields-and-graphs/#network-graphs}
 * @category Coordinate systems & graphs
 */
export const networkGraph = defineComposite<NetworkGraphProps>({
	name: "NetworkGraph",
	props: {
		vertices: { default: [], invalidates: Invalidate.UPDATE },
		edges: { default: [], invalidates: Invalidate.UPDATE },
		layout: { default: "spring", invalidates: Invalidate.UPDATE },
		layoutOptions: { invalidates: Invalidate.UPDATE },
		layoutScale: { invalidates: Invalidate.UPDATE },
		center: { invalidates: Invalidate.UPDATE },
		labels: { invalidates: Invalidate.UPDATE },
		vertexConfig: { invalidates: Invalidate.UPDATE },
		vertexConfigs: { invalidates: Invalidate.UPDATE },
		edgeConfig: { invalidates: Invalidate.UPDATE },
		edgeConfigs: { invalidates: Invalidate.UPDATE },
		directed: { default: false, invalidates: Invalidate.UPDATE },
		tipShape: { invalidates: Invalidate.UPDATE },
		renderVertex: { invalidates: Invalidate.UPDATE },
		renderEdge: { invalidates: Invalidate.UPDATE },
		// Split into phases the parts are bound to: no update.
		progress: { default: 1, invalidates: Invalidate.NONE },
		zIndex: { invalidates: Invalidate.UPDATE },
		visible: { invalidates: Invalidate.UPDATE },
		children: { kind: "children", invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => buildGraph(ctx, false),
	update: (_changed, ctx) => buildGraph(ctx, false),
});

/**
 * A directed {@link networkGraph}: edges are arrows from `source` to `target`
 * and `(u, v)` is no longer treated as `(v, u)` — Manim's `DiGraph`.
 *
 * Takes the same props as `networkGraph`, with `directed` defaulting to true.
 * Pass `directed: false` to turn the arrows off again.
 *
 * @example
 * ```ts
 * import { createScene, diGraph } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * scene.root.add(diGraph.create({ vertices: ["a", "b"], edges: [["a", "b"]], layout: "circular" }));
 * ```
 *
 * @category Coordinate systems & graphs
 */
export const diGraph = defineComposite<NetworkGraphProps>({
	name: "DiGraph",
	props: {
		...networkGraph.descriptor,
		directed: { default: true, invalidates: Invalidate.UPDATE },
	},
	setup: (ctx) => buildGraph(ctx, true),
	update: (_changed, ctx) => buildGraph(ctx, true),
});

/**
 * The {@link NetworkGraphHandle} of a `networkGraph` or `diGraph` node:
 * positions, radii and each part's node.
 *
 * @example
 * ```ts
 * import { createScene, networkGraph, networkHandle } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const graph = scene.root.add(networkGraph.create({ vertices: [1, 2], edges: [[1, 2]] }));
 * scene.commit();
 * const disc = networkHandle(graph).vertexHandle(1);
 * ```
 *
 * @param node - A graph node.
 * @returns Its handle; empty until the graph's first commit.
 * @category Coordinate systems & graphs
 */
export function networkHandle(node: SceneNode): NetworkGraphHandle {
	const state = () => states.get(node);
	return {
		vertexIds: () => [...(state()?.current?.positions.keys() ?? [])],
		edgeKeys: () =>
			(state()?.current?.edges ?? []).map((edge) =>
				edgeKey(edge.source, edge.target),
			),
		positions: () => state()?.current?.positions ?? new Map(),
		positionOf: (id) => state()?.current?.positions.get(id) ?? null,
		radiusOf: (id) => state()?.current?.radii.get(id) ?? DEFAULT_VERTEX_RADIUS,
		vertexHandle: (id) => state()?.vertexNodes.get(id),
		edgeHandle: (source, target) => {
			const current = state();
			if (!current) return undefined;
			return (
				current.edgeNodes.get(edgeKey(source, target)) ??
				(current.current?.directed
					? undefined
					: current.edgeNodes.get(edgeKey(target, source)))
			);
		},
	};
}
