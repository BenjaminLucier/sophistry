/**
 * `defineShape3D`: the one way a 3D primitive becomes a definition, and the
 * `Shape3DNode` pipeline behind it.
 *
 * ## How to write a 3D primitive
 *
 * A 3D primitive is two pure functions over its props:
 *
 * - `world(props)` builds its world-space geometry (a mesh's faces, a
 *   curve's samples). It reruns only when a prop marked `Invalidate.GEOMETRY`
 *   changes, never on a camera move.
 * - `project(world, camera, props, theme)` turns that geometry into the
 *   pieces it draws: one {@link ProjectedPiece} per 2D shape (a face, a disc,
 *   a polyline), each with a scene-unit `geometry`, a fallback `z` and,
 *   to take part in the camera's depth sort, a `depth` item. It reruns when
 *   the camera moves, when `world` reran, when the theme changes, or when a
 *   prop marked `Invalidate.UPDATE` changes.
 *
 * Every piece becomes one child shape node (reused by index across
 * re-projections), so a piece is one
 * `ShapeSpec` with its own `zIndex`: that is what lets the faces of separate
 * solids interleave by depth. The shared {@link shape3DProps} (paints,
 * reveal, interaction) are forwarded to every piece without re-projecting;
 * a piece's `style` overrides them key by key (a mesh face's shaded `fill`,
 * a sphere's default `stroke: "none"`). A prop that `project` reads must be
 * marked `Invalidate.UPDATE`, even one from `shape3DProps`.
 *
 * ```ts
 * import { Invalidate } from "@sophistry/core";
 * import { defineShape3D, depthZ, projectPoint, shape3DProps } from "@sophistry/3d";
 *
 * export const marker3D = defineShape3D<Marker3DProps, Point3>({
 * 	name: "Marker3D",
 * 	props: { ...shape3DProps, at: { invalidates: Invalidate.GEOMETRY } },
 * 	world: (props) => props.at ?? ORIGIN,
 * 	project: (at, camera) => {
 * 		const p = projectPoint(camera, at);
 * 		if (!p) return [];
 * 		return [{ geometry: { polylines: [[p, { x: p.x + 0.1, y: p.y }]] }, z: depthZ(p.depth) }];
 * 	},
 * });
 * ```
 *
 * ## Caching
 *
 * A camera move notifies every primitive under the camera (`UPDATE`): each
 * re-projects its cached world geometry, hands its new depth items to the
 * camera's sorter and waits; the sorter runs once, after all of them, and
 * hands back new `z` slices only to the primitives whose slice changed (by
 * value). Only then are the pieces written to the child shapes, so each
 * child refreshes once per commit. A primitive whose pieces did not move
 * keeps its children untouched.
 */

import {
	type Bounds,
	type ContextKey,
	type Definition,
	definePrimitive,
	defineShape,
	Invalidate,
	type InvalidateBits,
	interactionProps,
	type PropsDescriptor,
	type ShapeGeometry,
	type ShapeNode,
	type ShapeProps,
	shapeProps,
	themeContext,
} from "@sophistry/core";
import type { InteractionHandlers } from "@sophistry/core/internal";
import { ANY_CONTEXT, BaseContainer } from "@sophistry/core/internal";
import type { Theme } from "@sophistry/core/themes";
import { type Camera3DValue, camera3DContext } from "./context.js";
import type { DepthItem, DepthSource } from "./depth-sort.js";
import type { Shape3DProps } from "./props3d.js";

/**
 * One 2D shape a 3D primitive draws: a face, a disc, a polyline.
 *
 * @category Extending
 */
export interface ProjectedPiece {
	/** The projected outline, in scene units (the camera's origin included). */
	geometry: ShapeGeometry;
	/**
	 * Paint order before (or without) the camera's sort: `depthZ` of the
	 * piece's centroid depth.
	 */
	z: number;
	/** The piece's footprint for the camera's depth sort. Omit to keep `z`. */
	depth?: DepthItem;
	/**
	 * Props for this piece that win over the forwarded ones (a face's shaded
	 * `fill`, a default `stroke`). Whatever `project` derives them from must
	 * be marked `Invalidate.UPDATE`. Keep the same keys across re-projections:
	 * a key a piece stops overriding keeps its last value.
	 */
	style?: Readonly<Partial<ShapeProps>>;
}

/**
 * Options for {@link defineShape3D}.
 *
 * @typeParam P - The primitive's props.
 * @typeParam W - Its world geometry.
 *
 * @category Extending
 */
export interface Shape3DOptions<P extends Shape3DProps, W> {
	/** PascalCase display and codegen name (`"Sphere3D"`). */
	name: string;
	/**
	 * One entry per prop: `...shape3DProps` plus the primitive's own. World
	 * inputs are `Invalidate.GEOMETRY`; inputs `project` reads are `Invalidate.UPDATE`.
	 */
	props: PropsDescriptor<P>;
	/** The world-space geometry, from the props it reads. Camera-independent. */
	world: (props: Readonly<P>) => W;
	/** The pieces drawn for `world` through `camera`. */
	project: (
		world: W,
		camera: Camera3DValue,
		props: Readonly<P>,
		theme: Theme,
	) => readonly ProjectedPiece[];
}

/**
 * The stage bit a `Shape3DNode` uses for "the camera's sort handed me new z
 * values": `TRANSFORM`, which a container that does not transform has no
 * other use for.
 */
const DEPTH = Invalidate.TRANSFORM;

/** The stages that only forward props to the pieces. */
const FORWARD = Invalidate.STYLE | Invalidate.SPEC | Invalidate.INTERACTION;

/** The shape props forwarded to every piece as they are. */
const STYLE_KEYS = [
	"stroke",
	"strokeWidth",
	"fill",
	"strokeAlong",
	"opacity",
	"fillOpacity",
	"dash",
	"dashOffset",
	"lineCap",
	"lineJoin",
	"progress",
	"visible",
] as const satisfies readonly (keyof Shape3DProps)[];

/** Interaction props that are not handlers: forwarded as they are. */
const RECORD_KEYS = [
	"pointerEvents",
	"hitArea",
	"cursor",
	"label",
	"role",
	"pressed",
	"focusable",
] as const satisfies readonly (keyof Shape3DProps)[];

/**
 * Handler and behaviour props: forwarded from the node's merged handlers,
 * so `node.on("tap", ...)` on a 3D primitive reaches its pieces too.
 */
const HANDLER_KEYS = (
	Object.keys(interactionProps) as (keyof Shape3DProps)[]
).filter(
	(key) => !(RECORD_KEYS as readonly (keyof Shape3DProps)[]).includes(key),
) as (keyof InteractionHandlers & keyof Shape3DProps)[];

const EMPTY_PIECES: readonly ProjectedPiece[] = Object.freeze([]);
const EMPTY_ITEMS: readonly DepthItem[] = Object.freeze([]);
const EMPTY_GEOMETRY: ShapeGeometry = Object.freeze({
	polylines: [],
	closed: false,
});

/** @internal Props of the hidden child shape behind each piece. */
interface ProjectedShapeProps extends ShapeProps {
	/** The projected outline, in scene units. */
	geometry?: ShapeGeometry;
}

/**
 * The child shape behind one piece: its outline is the projected geometry,
 * as given. Not exported: only `Shape3DNode` creates it.
 */
const projectedShape = defineShape<ProjectedShapeProps>({
	name: "ProjectedShape3D",
	props: {
		...shapeProps,
		geometry: { invalidates: Invalidate.GEOMETRY },
	},
	geometry: (props) => props.geometry ?? EMPTY_GEOMETRY,
});

type PieceNode = ShapeNode<ProjectedShapeProps>;

/**
 * The node every {@link defineShape3D} definition makes: a container of
 * projected child shapes, one per piece. Its own interaction props describe
 * the pieces (they are forwarded); it is never hit itself.
 *
 * @category Extending
 */
export class Shape3DNode<P extends Shape3DProps = Shape3DProps, W = unknown>
	extends BaseContainer<P>
	implements DepthSource
{
	private readonly options: Shape3DOptions<P, W>;
	private camera: Camera3DValue | null = null;
	private stopCamera: (() => void) | null = null;
	private stopDepth: (() => void) | null = null;
	private worldValue: W | undefined = undefined;
	private worldStale = true;
	private pieces: readonly ProjectedPiece[] = EMPTY_PIECES;
	/** The pieces' depth items, in piece order (explicit `zIndex`: none). */
	private items: readonly DepthItem[] = EMPTY_ITEMS;
	/** Per piece, the index of its depth item in `items`, or -1. */
	private itemIndex: Int32Array = new Int32Array(0);
	/** The items the camera's sort last placed, and their `z`. */
	private sortedItems: readonly DepthItem[] | null = null;
	private sortedZ: Float64Array | null = null;
	/** Whether the children show `pieces` yet. */
	private piecesApplied = true;
	/** Whether the pieces wait for the camera's sort before being written. */
	private awaitingSort = false;
	/** Whether forwarded props changed since they were last written. */
	private forwardStale = true;

	constructor(definition: Definition<P>, options: Shape3DOptions<P, W>) {
		super(definition);
		this.options = options;
	}

	/** The pieces last projected, in child order. */
	get projectedPieces(): readonly ProjectedPiece[] {
		return this.pieces;
	}

	/** The world geometry last built (built now if it is stale). */
	get world(): W {
		this.refresh();
		return this.worldValue as W;
	}

	/* --------------------------------------------------------- the camera */

	/** The camera above, (re)subscribing when it changed. */
	private connect(): Camera3DValue {
		const camera = this.context(camera3DContext);
		if (camera === this.camera && camera) return camera;
		this.disconnect();
		if (!camera) {
			throw new Error(`${this.type} must be inside a camera3D.`);
		}
		this.camera = camera;
		this.stopCamera = camera.subscribe(() =>
			this.invalidate(Invalidate.UPDATE),
		);
		this.stopDepth = camera.depthOrder?.register(this) ?? null;
		return camera;
	}

	private disconnect(): void {
		this.stopCamera?.();
		this.stopDepth?.();
		this.stopCamera = null;
		this.stopDepth = null;
		this.camera = null;
		this.sortedItems = null;
		this.sortedZ = null;
	}

	/* ---------------------------------------------------------- the sort */

	depthItems(): readonly DepthItem[] {
		this.refresh();
		return this.items;
	}

	depthSorted(z: Float64Array): void {
		this.sortedItems = this.items;
		this.sortedZ = z;
		this.awaitingSort = false;
		this.invalidate(DEPTH);
	}

	/* ------------------------------------------------------------ stages */

	protected override run(dirty: InvalidateBits): void {
		if (dirty & Invalidate.GEOMETRY) this.worldStale = true;
		if (dirty & (Invalidate.GEOMETRY | Invalidate.UPDATE)) this.resolve();
		if (dirty & FORWARD) this.forwardStale = true;
		if (
			!this.awaitingSort &&
			(!this.piecesApplied || this.forwardStale || dirty & DEPTH)
		) {
			this.writePieces();
		}
	}

	/** Re-projects (rebuilding the world first if stale) and hands the sort the new items. */
	private resolve(): void {
		const camera = this.connect();
		const props = this.props;
		if (this.worldStale) {
			this.worldValue = this.options.world(props);
			this.worldStale = false;
		}
		const pieces = this.options.project(
			this.worldValue as W,
			camera,
			props,
			this.context(themeContext),
		);
		const hadItems = this.items.length > 0;
		const itemIndex = new Int32Array(pieces.length).fill(-1);
		let items: DepthItem[] | readonly DepthItem[] = EMPTY_ITEMS;
		// An explicit `zIndex` opts the whole primitive out of the sort: every
		// piece paints at that `zIndex`.
		if (props.zIndex === undefined) {
			const list: DepthItem[] = [];
			for (let i = 0; i < pieces.length; i++) {
				const depth = pieces[i].depth;
				if (!depth) continue;
				itemIndex[i] = list.length;
				list.push(depth);
			}
			if (list.length > 0) items = list;
		}
		this.pieces = pieces;
		this.items = items;
		this.itemIndex = itemIndex;
		this.piecesApplied = false;
		const sorter = camera.depthOrder;
		this.awaitingSort = sorter !== undefined && items.length > 0;
		if (sorter && (hadItems || items.length > 0)) sorter.changed();
	}

	/** The `zIndex` piece `index` paints at. */
	private zOf(index: number): number {
		const explicit = this.props.zIndex;
		if (explicit !== undefined) return explicit;
		const item = this.itemIndex[index];
		if (item >= 0 && this.sortedItems === this.items && this.sortedZ) {
			return this.sortedZ[item];
		}
		return this.pieces[index].z;
	}

	/** The forwarded props, as one object (every key present, unset ones undefined). */
	private forwarded(): Partial<ShapeProps> {
		const props = this.props as Shape3DProps;
		const out: Record<string, unknown> = {};
		for (const key of STYLE_KEYS) out[key] = props[key];
		for (const key of RECORD_KEYS) out[key] = props[key];
		const handlers = this.interactionHandlers() as Record<string, unknown>;
		for (const key of HANDLER_KEYS) out[key] = handlers[key];
		return out as Partial<ShapeProps>;
	}

	/** Writes the pieces (or just what changed about them) to the children. */
	private writePieces(): void {
		const pieces = this.pieces;
		const children = this.childNodes as unknown as PieceNode[];
		const newPieces = !this.piecesApplied;
		const forwarded =
			this.forwardStale || pieces.length > children.length
				? this.forwarded()
				: null;
		const writeForwarded = this.forwardStale;
		let next: PieceNode[] | null = null;
		if (pieces.length !== children.length) {
			next = children.slice(0, pieces.length);
		}
		for (let i = 0; i < pieces.length; i++) {
			const piece = pieces[i];
			const style = piece.style;
			const zIndex = this.zOf(i);
			let child = children[i];
			if (!child) {
				child = projectedShape.create();
				if (forwarded) writeProps(child, forwarded, style);
				if (style) writeStyle(child, style);
				child.set("geometry", piece.geometry);
				child.set("zIndex", zIndex);
				(next as PieceNode[]).push(child);
				continue;
			}
			if (writeForwarded && forwarded) writeProps(child, forwarded, style);
			if (newPieces) {
				child.set("geometry", piece.geometry);
				if (style) writeStyle(child, style);
			}
			child.set("zIndex", zIndex);
		}
		this.piecesApplied = true;
		this.forwardStale = false;
		if (next) this.setChildren(next);
	}

	/* ----------------------------------------------------------- context */

	protected override stagesForContext(
		key: ContextKey<unknown>,
	): InvalidateBits {
		if (
			key === themeContext ||
			key === camera3DContext ||
			key === ANY_CONTEXT
		) {
			return Invalidate.UPDATE;
		}
		return 0;
	}

	/** The pieces answer the pointer (they get the forwarded props); this node never does. */
	override wantsInteraction(): boolean {
		return false;
	}

	/* ----------------------------------------------------------- handles */

	override bounds(): Bounds | null {
		this.refresh();
		// Asked between a re-projection and the sort: show the new outlines now
		// (the sort only reorders them).
		if (!this.piecesApplied) {
			this.awaitingSort = false;
			this.writePieces();
		}
		return super.bounds();
	}

	protected override disposeContents(): void {
		this.disconnect();
		super.disposeContents();
	}
}

/** Writes `forwarded` to `child`, leaving the keys `style` overrides alone. */
function writeProps(
	child: PieceNode,
	forwarded: Partial<ShapeProps>,
	style: Readonly<Partial<ShapeProps>> | undefined,
): void {
	for (const key of Object.keys(forwarded) as (keyof ShapeProps)[]) {
		if (style && key in style) continue;
		child.set(key, forwarded[key] as never);
	}
}

/** Writes a piece's own props. */
function writeStyle(
	child: PieceNode,
	style: Readonly<Partial<ShapeProps>>,
): void {
	for (const key of Object.keys(style) as (keyof ShapeProps)[]) {
		child.set(key, style[key] as never);
	}
}

/**
 * Makes a 3D primitive definition from a world builder and a projector (see
 * the module header for the pipeline and its caching).
 *
 * @param options - See {@link Shape3DOptions}.
 * @returns The definition; `create(props)` makes a {@link Shape3DNode}.
 * @category Extending
 */
export function defineShape3D<P extends Shape3DProps, W>(
	options: Shape3DOptions<P, W>,
): Definition<P, Shape3DNode<P, W>> {
	return definePrimitive<P, Shape3DNode<P, W>>({
		name: options.name,
		props: options.props,
		node: (definition) => new Shape3DNode<P, W>(definition, options),
	});
}
