/**
 * The commit engine of one scene: the dirty list, the incremental frame
 * collector and the bookkeeping the interaction registry reads. No DOM and
 * no renderer: `createScene` wraps a graph with those, and a headless scene
 * is a graph alone.
 *
 * A commit (once per frame, in the shared frame loop's commit phase):
 *
 * 1. refreshes every node on the dirty list (pull stale bindings, rerun the
 *    pending stages; a container whose space changed marks its children,
 *    which join the same drain);
 * 2. if the tree's structure changed, recomputes the depth-first order and
 *    re-sorts the frame; otherwise patches the specs that changed into a
 *    copy of the last frame, splicing visibility or `zIndex` changes in by
 *    binary search;
 * 3. hands the frame to `onFrame` (the renderer's `setFrame`).
 *
 * A commit with nothing dirty returns at once. The result always equals
 * `compileFrame` over the drawables in tree order; the tests check that.
 */

import type { DrawSpec } from "../spec/types";
import { requestFrame } from "../tween/frame-loop";
import { BaseContainer } from "./container";
import type { BaseNode } from "./node";
import { ROOT_SPACE } from "./node";
import type { Definition, InvalidateBits, Space } from "./types";
import { SpaceChange } from "./types";

/**
 * More structural moves than this in one commit are cheaper as one re-sort
 * than as that many array splices.
 */
const MAX_SPLICES = 16;

/**
 * Options for a {@link SceneGraph}.
 *
 * @category Scene graph
 */
export interface SceneGraphOptions {
	/**
	 * Asks for `commit` to run. Defaults to the shared frame loop's commit
	 * phase (`requestFrame("commit", commit)`). Tests pass their own.
	 */
	schedule?: (commit: () => void) => void;
	/** Receives each new frame (the renderer's `setFrame`). */
	onFrame?: (
		frame: readonly DrawSpec[],
		options: { membershipChanged: boolean },
	) => void;
	/**
	 * Whether scene `y` runs up the screen.
	 * @default true
	 */
	yUp?: boolean;
	/**
	 * Called after a web font finished loading, once the graph listens for
	 * loads (it has text; see `scene/fonts.ts`): the renderer's `invalidate`.
	 */
	onFontLoad?: () => void;
}

/** Counters for tests and benchmarks. */
export interface SceneGraphStats {
	/** Commits that did work. */
	commits: number;
	/** Node refreshes run by commits. */
	refreshes: number;
	/** Full re-sorts of the frame. */
	rebuilds: number;
	/** Commits that patched specs in place. */
	patches: number;
}

const ROOT_DEFINITION: Definition = {
	kind: "primitive",
	name: "Scene",
	descriptor: {},
	container: true,
	create: () => {
		throw new Error("The scene root is made by the scene.");
	},
};

/**
 * The root container of a scene graph: hands its children the scene's root
 * space (identity, opaque, unclipped, the scene's `yUp`).
 *
 * @category Scene graph
 */
export class SceneRoot extends BaseContainer {
	private rootSpace: Space = ROOT_SPACE;

	constructor(graph: SceneGraph) {
		super(ROOT_DEFINITION);
		this.graph = graph;
		this.dirty = 0;
	}

	override get childSpace(): Space {
		return this.rootSpace;
	}

	/** @internal Sets the root space's `yUp`. */
	setYUp(yUp: boolean): void {
		if (this.rootSpace.yUp === yUp) return;
		this.rootSpace = { ...this.rootSpace, yUp };
		for (const child of this.childNodes) child.spaceChanged(SpaceChange.Y_UP);
	}

	protected override run(_dirty: InvalidateBits): void {}
}

/**
 * One scene's retained tree and commit engine.
 *
 * @category Scene graph
 */
export class SceneGraph {
	/** The root container; add the scene's nodes to it. */
	readonly root: SceneRoot;
	/** The last frame handed to `onFrame`: drawables' specs in paint order. */
	frame: readonly DrawSpec[] = [];
	/** Bumped whenever the tree's structure (membership or order) changed. */
	structureVersion = 0;
	/** Bumped whenever a node's interaction record may have changed. */
	interactionVersion = 0;
	/** Nodes that want an interaction record. */
	readonly interactive = new Set<BaseNode>();
	/** Drawables in tree order, as of the last commit. */
	ordered: BaseNode[] = [];
	readonly stats: SceneGraphStats = {
		commits: 0,
		refreshes: 0,
		rebuilds: 0,
		patches: 0,
	};

	private readonly options: SceneGraphOptions;
	private dirtyNodes: BaseNode[] = [];
	private specChanges: BaseNode[] = [];
	private structureDirty = true;
	private scheduled = false;
	private committing = false;
	private disposed = false;
	/** The drawables behind `frame`, same indices, sorted by `(zIndex, treeIndex)`. */
	private frameNodes: BaseNode[] = [];
	private readonly interactionListeners = new Set<() => void>();
	private readonly structureListeners = new Set<() => void>();
	private readonly runCommit = () => {
		this.commit();
	};
	/**
	 * @internal Ends the font-load subscription `watchFontLoads`
	 * (`scene/fonts.ts`) started, or null while there is none.
	 */
	fontWatch: (() => void) | null = null;

	constructor(options: SceneGraphOptions = {}) {
		this.options = options;
		this.root = new SceneRoot(this);
		if (options.yUp === false) this.root.setYUp(false);
	}

	/** Sets whether scene `y` runs up; nodes that care (text) update. */
	setYUp(yUp: boolean): void {
		this.root.setYUp(yUp);
	}

	/* ------------------------------------------------------- scheduling */

	private schedule(): void {
		if (this.scheduled || this.committing || this.disposed) return;
		this.scheduled = true;
		if (this.options.schedule) this.options.schedule(this.runCommit);
		else requestFrame("commit", this.runCommit);
	}

	/** @internal Puts a node on the dirty list. */
	enqueue(node: BaseNode): void {
		node.queued = true;
		this.dirtyNodes.push(node);
		this.schedule();
	}

	/** @internal A node published a different spec. */
	specChanged(node: BaseNode): void {
		this.specChanges.push(node);
		this.schedule();
	}

	/** @internal Membership or order changed somewhere in the tree. */
	structureChanged(): void {
		this.structureDirty = true;
		this.schedule();
	}

	/** @internal A node joined the graph. */
	nodeAttached(_node: BaseNode): void {
		this.structureChanged();
	}

	/** @internal A node left the graph. */
	nodeDetached(node: BaseNode): void {
		if (this.interactive.delete(node)) this.interactionChanged();
		this.structureChanged();
	}

	/** @internal Re-reads whether `node` wants an interaction record. */
	syncInteraction(node: BaseNode): void {
		if (node.graph === this && node.wantsInteraction()) {
			this.interactive.add(node);
			this.interactionChanged();
		} else if (this.interactive.delete(node)) {
			this.interactionChanged();
		}
		// A node with no record before and none now changed nothing: every new
		// node passes here once (its first refresh), most of them without
		// handlers.
	}

	private interactionChanged(): void {
		this.interactionVersion++;
		for (const listener of [...this.interactionListeners]) listener();
	}

	/**
	 * Calls `listener` whenever an interaction record may have changed (a node
	 * gained or lost handlers, or left). Runs synchronously, usually inside a
	 * commit: only mark. Returns the unsubscribe function.
	 */
	onInteractionChange(listener: () => void): () => void {
		this.interactionListeners.add(listener);
		return () => {
			this.interactionListeners.delete(listener);
		};
	}

	/**
	 * Calls `listener` after a commit that changed the tree's structure (tree
	 * order may differ). Returns the unsubscribe function.
	 */
	onStructureChange(listener: () => void): () => void {
		this.structureListeners.add(listener);
		return () => {
			this.structureListeners.delete(listener);
		};
	}

	/** Whether a commit would do anything. */
	needsCommit(): boolean {
		return (
			this.dirtyNodes.length > 0 ||
			this.specChanges.length > 0 ||
			this.structureDirty
		);
	}

	/* ----------------------------------------------------------- commit */

	/**
	 * Brings the frame up to date: refreshes dirty nodes, collects the specs
	 * and hands a changed frame to `onFrame`. Returns whether the frame
	 * changed. Runs in the frame loop's commit phase; tests and headless
	 * scenes may call it directly.
	 */
	commit(): boolean {
		this.scheduled = false;
		if (this.disposed || !this.needsCommit()) return false;
		this.committing = true;
		let changed = false;
		let membershipChanged = false;
		try {
			this.stats.commits++;
			const dirty = this.dirtyNodes;
			// The list grows while it drains: a container whose space changed
			// marks its children, which land at the end.
			for (let i = 0; i < dirty.length; i++) {
				const node = dirty[i] as BaseNode;
				node.queued = false;
				if (node.graph !== this) continue;
				if (node.needsRefresh()) {
					this.stats.refreshes++;
					node.refresh();
				}
			}
			this.dirtyNodes = [];

			const structural = this.structureDirty;
			if (structural) {
				this.structureDirty = false;
				this.reorder();
				this.specChanges = [];
				const result = this.rebuild();
				this.frame = result.frame;
				changed = true;
				membershipChanged = result.membershipChanged;
			} else if (this.specChanges.length > 0) {
				const result = this.patch();
				changed = result !== null;
				if (result) {
					this.frame = result.frame;
					membershipChanged = result.membershipChanged;
				}
			}
			if (structural) {
				for (const listener of [...this.structureListeners]) listener();
			}
		} finally {
			this.committing = false;
		}
		if (changed) this.options.onFrame?.(this.frame, { membershipChanged });
		if (this.needsCommit()) this.schedule();
		return changed;
	}

	/** Recomputes the depth-first order: every node's `treeIndex`, and the drawables. */
	private reorder(): void {
		this.structureVersion++;
		const ordered: BaseNode[] = [];
		let index = 0;
		const stack: BaseNode[] = [this.root];
		while (stack.length > 0) {
			const node = stack.pop() as BaseNode;
			node.treeIndex = index++;
			if (node.producesSpec) ordered.push(node);
			if (node instanceof BaseContainer) {
				const children = node.childNodes;
				for (let i = children.length - 1; i >= 0; i--) {
					stack.push(children[i] as BaseNode);
				}
			}
		}
		this.ordered = ordered;
	}

	/**
	 * Re-sorts the whole frame from the drawables in tree order, and tells
	 * whether the set of nodes in it changed: a reshuffle or a `zIndex` change
	 * keeps every node, which spares the renderer its scene-sized sweep for
	 * nodes that left.
	 */
	private rebuild(): { frame: DrawSpec[]; membershipChanged: boolean } {
		this.stats.rebuilds++;
		const live: BaseNode[] = [];
		// Nodes in the last frame still have `published` set (a node that left
		// the graph had it cleared). If every live node was in it and the
		// counts match, it is the same set.
		let entered = false;
		// Most scenes never set `zIndex`, so tree order is usually paint order
		// already; the sort only runs when some spec sits below its predecessor.
		let sorted = true;
		let lastZ = Number.NEGATIVE_INFINITY;
		for (const node of this.ordered) {
			const spec = node.spec;
			if (spec && node.published === null) entered = true;
			node.published = null;
			if (!spec) continue;
			live.push(node);
			const z = node.specZIndex;
			if (z < lastZ) sorted = false;
			lastZ = z;
		}
		// Stable: ties stay in tree order.
		if (!sorted) live.sort((a, b) => a.specZIndex - b.specZIndex);
		const frame: DrawSpec[] = new Array(live.length);
		for (let i = 0; i < live.length; i++) {
			const node = live[i] as BaseNode;
			node.published = node.spec;
			node.publishedZIndex = node.specZIndex;
			node.frameSlot = i;
			frame[i] = node.spec as DrawSpec;
		}
		const membershipChanged = entered || live.length !== this.frame.length;
		this.frameNodes = live;
		return { frame, membershipChanged };
	}

	/**
	 * Patches changed specs into a copy of the frame. Returns null when no
	 * published spec actually changed.
	 *
	 * One pass puts every spec that kept its `zIndex` straight into its
	 * node's slot (known from the last rebuild: no search) and sets aside the
	 * ones that enter, leave or change `zIndex`. Those are then spliced in by
	 * binary search, or, past {@link MAX_SPLICES}, the frame is re-sorted.
	 * The in-place writes keep every node's position, so the searches after
	 * them see a consistent order.
	 */
	private patch(): { frame: DrawSpec[]; membershipChanged: boolean } | null {
		const changes = this.specChanges;
		this.specChanges = [];
		let frame: DrawSpec[] | null = null;
		let moved: BaseNode[] | null = null;
		for (const node of changes) {
			if (node.graph !== this) continue;
			const before = node.published;
			const after = node.spec;
			if (before === after) continue;
			// The z values are the nodes' copies, not the specs' (see `specZIndex`).
			if (before && after && node.publishedZIndex === node.specZIndex) {
				frame ??= this.frame.slice();
				frame[node.frameSlot] = after;
				node.published = after;
			} else {
				moved ??= [];
				moved.push(node);
			}
		}
		if (!moved) {
			if (!frame) return null;
			this.stats.patches++;
			return { frame, membershipChanged: false };
		}
		if (moved.length > MAX_SPLICES) {
			return this.rebuild();
		}
		frame ??= this.frame.slice();
		const nodes = this.frameNodes.slice();
		// Only an entry or an exit changes membership; a `zIndex` change moves
		// a node that stays.
		let membershipChanged = false;
		for (const node of moved) {
			const before = node.published;
			const after = node.spec;
			// Listed twice (it published twice): already spliced.
			if (before === after) continue;
			if (!before || !after) membershipChanged = true;
			if (before) {
				const at = lowerBound(nodes, node.publishedZIndex, node.treeIndex);
				frame.splice(at, 1);
				nodes.splice(at, 1);
				node.published = null;
			}
			if (after) {
				const at = lowerBound(nodes, node.specZIndex, node.treeIndex);
				frame.splice(at, 0, after);
				nodes.splice(at, 0, node);
				node.published = after;
				node.publishedZIndex = node.specZIndex;
			}
		}
		// The splices shifted slots; renumber (as cheap as the splices were).
		for (let i = 0; i < nodes.length; i++) {
			(nodes[i] as BaseNode).frameSlot = i;
		}
		this.frameNodes = nodes;
		this.stats.patches++;
		this.stats.rebuilds++;
		return { frame, membershipChanged };
	}

	/** @internal A web font finished loading: tells `onFontLoad`. */
	fontLoaded(): void {
		if (!this.disposed) this.options.onFontLoad?.();
	}

	/** Disposes every node and stops scheduling. */
	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.fontWatch?.();
		this.fontWatch = null;
		this.root.dispose();
		this.dirtyNodes = [];
		this.specChanges = [];
		this.interactive.clear();
		this.interactionListeners.clear();
		this.structureListeners.clear();
		this.frame = [];
		this.frameNodes = [];
		this.ordered = [];
	}
}

/**
 * The first index in `nodes` whose `(zIndex, treeIndex)` is not below
 * `(z, tree)`. Every node in the array has a published spec, and the pair is
 * unique per node, so a present node is found exactly at its lower bound.
 */
function lowerBound(
	nodes: readonly BaseNode[],
	z: number,
	tree: number,
): number {
	let lo = 0;
	let hi = nodes.length;
	while (lo < hi) {
		const mid = (lo + hi) >>> 1;
		const probe = nodes[mid] as BaseNode;
		const probeZ = probe.publishedZIndex;
		if (probeZ < z || (probeZ === z && probe.treeIndex < tree)) lo = mid + 1;
		else hi = mid;
	}
	return lo;
}
