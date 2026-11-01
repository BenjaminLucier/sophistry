/**
 * `camera3D` owns one `Projection` (a view matrix plus a perspective divide,
 * `geometry3d/camera.ts`) and provides it to its subtree. 3D shapes under it
 * project their world geometry into ordinary scene-unit specs, so the
 * renderer, picking, accessibility and 2D cameras need no knowledge of 3D.
 *
 * The camera is a container that does not transform: its children live in
 * its own space. Besides the projection it owns the depth sort shared by
 * everything under it, run by a hidden last child (`DepthSortNode`) so that
 * the sort lands after every primitive re-projected in the same commit.
 */

import {
	type Definition,
	definePrimitive,
	frameContext,
	Invalidate,
	type InvalidateBits,
	type PropDescriptor,
	type SceneNode,
} from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import {
	BaseContainer,
	BaseNode,
	type Point3,
	Projection,
} from "@sophistry/core/internal";
import { type Camera3DValue, camera3DContext } from "./context.js";
import { createDepthSorter, type DepthSorterRunner } from "./depth-sort.js";

/** @category Camera */
export interface Camera3DProps {
	/**
	 * Camera position, in world units. Must differ from `target`.
	 * @default `{ x: 6, y: 4, z: 8 }`
	 */
	eye?: Point3;
	/** What the camera looks at, in world units. Defaults to the world origin. */
	target?: Point3;
	/**
	 * Up direction (a direction, not a position). Must not be parallel to `eye - target`.
	 * @default `{ x: 0, y: 1, z: 0 }`
	 */
	up?: Point3;
	/**
	 * Vertical field of view, in degrees (not radians).
	 * @default 50
	 */
	fov?: number;
	/**
	 * Where the camera's target lands on the stage.
	 * @default { x: 0, y: 0 }
	 */
	origin?: Point;
	/**
	 * How large the projection is in scene units (larger draws the scene larger).
	 * Independent of the stage's zoom; changing `units` later does not change it. Defaults to the
	 * frame height when the camera first refreshes.
	 */
	viewHeight?: number;
	/** The 3D shapes (and any 2D shapes) drawn through the camera. */
	children?: readonly SceneNode[];
}

const DEFAULT_EYE: Point3 = Object.freeze({ x: 6, y: 4, z: 8 });
const DEFAULT_TARGET: Point3 = Object.freeze({ x: 0, y: 0, z: 0 });
const DEFAULT_UP: Point3 = Object.freeze({ x: 0, y: 1, z: 0 });
const DEFAULT_ORIGIN: Point = Object.freeze({ x: 0, y: 0 });

/**
 * The hidden last child of a camera: refreshing it runs the camera's depth
 * sort. Being a node on the scene's dirty list is what orders the sort after
 * the primitives that asked for it (the list drains in order and grows while
 * it drains), and no child ever refreshes it as a parent.
 */
class DepthSortNode extends BaseNode {
	private readonly sorter: DepthSorterRunner;

	constructor(definition: Definition, sorter: DepthSorterRunner) {
		super(definition);
		this.sorter = sorter;
		// Nothing to do until a primitive asks.
		this.dirty = 0;
	}

	protected run(_dirty: InvalidateBits): void {
		this.sorter.sort();
	}
}

/** The definition behind `DepthSortNode`s: internal, never created through it. */
const depthSortDefinition: Definition = definePrimitive<object, BaseNode>({
	name: "DepthSort3D",
	props: {},
	node: () => {
		throw new Error("DepthSort3D nodes are made by camera3D.");
	},
});

/**
 * A `camera3D` node: provides its {@link Camera3DValue} to its subtree and
 * keeps its projection in sync with its props.
 *
 * @category Camera
 */
export class Camera3DNode extends BaseContainer<Camera3DProps> {
	/** The value provided under {@link camera3DContext}. */
	readonly value: Camera3DValue;
	private readonly projection = new Projection();
	private readonly sortNode: DepthSortNode;
	private readonly cameraListeners = new Set<() => void>();
	private originPoint: Point = DEFAULT_ORIGIN;
	/** The frame height when the camera first refreshed (see `viewHeight`). */
	private mountHeight: number | null = null;

	constructor(definition: Definition<Camera3DProps>) {
		super(definition);
		// One sort over every piece drawn under this camera, so faces of separate
		// solids interleave by depth instead of each solid sorting alone.
		const sorter = createDepthSorter(
			() => this.projection.eye,
			() => this.sortNode.invalidate(Invalidate.UPDATE),
		);
		this.sortNode = new DepthSortNode(depthSortDefinition, sorter);
		this.value = {
			origin: () => {
				this.refresh();
				return this.originPoint;
			},
			ensure: () => {
				this.refresh();
				return this.projection;
			},
			subscribe: (onChange) => {
				this.cameraListeners.add(onChange);
				return () => {
					this.cameraListeners.delete(onChange);
				};
			},
			depthOrder: sorter,
		};
		this.provide(camera3DContext, this.value);
		this.setChildren([this.sortNode]);
	}

	/** The children as given, without the camera's hidden sort node. */
	override get children(): readonly SceneNode[] {
		return this.childNodes.filter((child) => child !== this.sortNode);
	}

	override setChildren(children: readonly SceneNode[]): void {
		// The sort node stays last, whatever the caller passes.
		const sortNode = this.sortNode;
		const given = children.filter((child) => child !== sortNode);
		super.setChildren(sortNode ? [...given, sortNode] : given);
	}

	override add<N extends SceneNode>(
		child: N,
		before: SceneNode | null = null,
	): N {
		return super.add(child, before ?? this.sortNode);
	}

	protected override propChanged<K extends keyof Camera3DProps>(
		key: K,
		descriptor: PropDescriptor<Camera3DProps[K]>,
	): void {
		if (descriptor.kind === "children") {
			this.setChildren(this.props.children ?? []);
			return;
		}
		super.propChanged(key, descriptor);
	}

	protected override run(dirty: InvalidateBits): void {
		if (!(dirty & Invalidate.UPDATE)) return;
		const props = this.props;
		// The frame height at the first refresh, read once: following it would
		// re-project the whole scene on every zoom frame.
		if (this.mountHeight === null) {
			const frame = this.context(frameContext).peek();
			this.mountHeight = frame.maxY - frame.minY;
		}
		this.projection.update(
			{
				eye: props.eye ?? DEFAULT_EYE,
				target: props.target ?? DEFAULT_TARGET,
				up: props.up ?? DEFAULT_UP,
				fovY: ((props.fov ?? 50) * Math.PI) / 180,
			},
			Math.max(1e-6, props.viewHeight ?? this.mountHeight),
		);
		this.originPoint = props.origin ?? DEFAULT_ORIGIN;
		for (const onChange of [...this.cameraListeners]) onChange();
	}
}

/**
 * A perspective camera that every 3D shape inside it is drawn through. Put 3D
 * shapes in its `children` (they throw without a camera above them). The
 * world is right-handed, y up; content projects into scene units, so 2D
 * shapes share the stage and 2D cameras zoom both. Every prop is bindable:
 * animate `eye` with a track. Pair with {@link orbitControls3D} for
 * drag-to-orbit.
 *
 * @example
 * ```ts
 * import { createScene, track } from "@sophistry/core";
 * import { camera3D, cube3D, sphere3D } from "@sophistry/3d";
 *
 * const scene = createScene({ host: document.querySelector("#figure")!, units: 10 });
 * const eye = track({ x: 6, y: 4, z: 8 });
 * scene.add(
 * 	camera3D.create({
 * 		eye,
 * 		children: [cube3D.create({ size: 2 }), sphere3D.create({ center: { x: 2, y: 0, z: 0 } })],
 * 	}),
 * );
 * ```
 *
 * @see {@link https://sophistry.dev/guides/3d/}
 * @category Camera
 */
export const camera3D = definePrimitive<Camera3DProps, Camera3DNode>({
	name: "Camera3D",
	container: true,
	props: {
		eye: { default: DEFAULT_EYE, invalidates: Invalidate.UPDATE },
		target: { default: DEFAULT_TARGET, invalidates: Invalidate.UPDATE },
		up: { default: DEFAULT_UP, invalidates: Invalidate.UPDATE },
		fov: { default: 50, invalidates: Invalidate.UPDATE },
		origin: { default: DEFAULT_ORIGIN, invalidates: Invalidate.UPDATE },
		viewHeight: { invalidates: Invalidate.UPDATE },
		children: { kind: "children", invalidates: Invalidate.NONE },
	},
	node: (definition) => new Camera3DNode(definition),
});
