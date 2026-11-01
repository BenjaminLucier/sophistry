/**
 * The interaction registry over a scene graph: who wants to be hit, and where,
 * read straight off the retained nodes. The graph already keeps the set of
 * nodes that want a record (`graph.interactive`) and their tree order
 * (`treeIndex`); this turns them into `InteractionRecord`s the pointer driver
 * and the accessibility mirror consume, without either knowing about nodes.
 *
 * Hit areas are declared in local units and mapped to scene units by the
 * node's space matrix (groups, never the camera); a `Bounds` maps as four
 * corners so it rotates with its group. Everything derived (the tree-ordered
 * list, the candidates, the flags, the tab stops, the group elections) is
 * cached on the registry's version and rebuilt lazily on the first read after
 * a bump, so a frame that changed no handler costs nothing here.
 */

import type { Bounds, Polyline } from "../geometry/index.js";
import type { Matrix } from "../geometry/transform.js";
import { applyToPolyline, invert } from "../geometry/transform.js";
import type {
	FocusChannel,
	FocusSource,
	InteractionRegistry,
} from "../interact/registry.js";
import type {
	HitArea,
	HitCandidate,
	InteractionHandlers,
	InteractionRecord,
} from "../interact/types.js";
import { isFocusable } from "../interact/types.js";
import { track } from "../reactive/index.js";
import type { SceneGraph } from "./graph.js";
import { mergeHandlers } from "./interaction-group.js";
import type { InteractionGroupValue } from "./interaction-group-context.js";
import { interactionGroupContext } from "./interaction-group-context.js";
import type { BaseNode } from "./node.js";
import { memo } from "./node.js";

/** The four corners of a box, in order. */
function cornersOf(box: Bounds): Polyline {
	return [
		{ x: box.minX, y: box.minY },
		{ x: box.maxX, y: box.minY },
		{ x: box.maxX, y: box.maxY },
		{ x: box.minX, y: box.maxY },
	];
}

/** A declared hit area in scene units, always as a polygon. */
function areaToScene(area: HitArea, matrix: Matrix): Polyline {
	return applyToPolyline(matrix, Array.isArray(area) ? area : cornersOf(area));
}

/** One node's record and the bookkeeping behind its getters. */
interface Entry {
	node: BaseNode;
	record: InteractionRecord;
	/** The enclosing group as of the last rebuild, or null. */
	group: InteractionGroupValue | null;
}

/**
 * An {@link InteractionRegistry} that can be stopped.
 *
 * @category Interaction plumbing
 */
export interface SceneInteractionRegistry extends InteractionRegistry {
	/** Stops listening to the graph. */
	dispose(): void;
}

/**
 * Creates the interaction registry of one scene graph. `createScene` does this
 * for you; it is exported for driving a graph on your own canvas.
 *
 * Records are built once per node and keep their identity; their getters read
 * the node's props live, so a node can stop being draggable, change its cursor
 * or grow its hit area without re-registering. A member of an
 * `interactionGroup` inherits the group's handlers (its own win key by key),
 * hit mode and cursor, and the group's first member in tree order carries its
 * label, role and the single tab stop.
 *
 * @param graph - The scene graph whose interactive nodes to expose.
 * @returns The registry; call `dispose` when the graph goes.
 *
 * @category Interaction plumbing
 */
export function createInteractionRegistry(
	graph: SceneGraph,
): SceneInteractionRegistry {
	const version = track(0);
	const entries = new WeakMap<BaseNode, Entry>();

	let builtAt = -1;
	let ordered: Entry[] = [];
	let records: InteractionRecord[] = [];
	let byId = new Map<number, InteractionRecord>();
	/** Outermost group → the id of its elected focus owner. */
	let owners = new Map<InteractionGroupValue, number>();

	const bump = () => version.set(version.peek() + 1);
	const unsubscribe = [
		graph.onInteractionChange(bump),
		graph.onStructureChange(bump),
	];

	/** Re-reads membership, group and tree order after a bump. */
	function ensure(): void {
		const current = version.peek();
		if (builtAt === current) return;
		builtAt = current;
		ordered = [];
		for (const node of graph.interactive) {
			const entry = entryFor(node);
			entry.group = node.context(interactionGroupContext);
			ordered.push(entry);
		}
		ordered.sort((a, b) => a.node.treeIndex - b.node.treeIndex);
		records = ordered.map((entry) => entry.record);
		byId = new Map();
		owners = new Map();
		for (const entry of ordered) {
			byId.set(entry.node.id, entry.record);
			// Sharing handlers makes several nodes answer one gesture, which is
			// right for the pointer and wrong for the keyboard: a labelled dot must
			// be one tab stop, not two. The first member in tree order carries it,
			// and a group whose first member leaves hands it to the next.
			const root = entry.group?.root();
			if (root && !owners.has(root)) owners.set(root, entry.node.id);
		}
	}

	function entryFor(node: BaseNode): Entry {
		const existing = entries.get(node);
		if (existing) return existing;
		const props = () => node.interactionProps();
		const mergedHandlers = memo(mergeHandlers);
		const inverse = memo(invert);
		const entry: Entry = { node, group: null, record: null as never };
		const focusOwner = (): number | null => {
			const root = entry.group?.root();
			if (!root) return null;
			ensure();
			return owners.get(root) ?? null;
		};
		/** The group's description applies to the node that carries its focus. */
		const owned = () => focusOwner() === node.id;
		entry.record = {
			id: node.id,
			// The chain *outside* the node's own `x`/`y`/`rotation`/`scale`, which
			// is the frame `hitArea` and `ScenePointerEvent.local` are defined in.
			toScene: () => node.space.matrix,
			// Memoised, so a drag reading `event.local` on every move inverts the
			// matrix once per change of the matrix rather than once per move.
			toLocal: () => inverse(node.space.matrix),
			pointerEvents: () =>
				props().pointerEvents ?? entry.group?.pointerEvents() ?? "painted",
			hitArea: () => props().hitArea ?? null,
			cursor: () => props().cursor ?? entry.group?.cursor() ?? null,
			handlers: (): InteractionHandlers => {
				const own = node.interactionHandlers();
				const group = entry.group;
				return group ? mergedHandlers(group.handlers(), own) : own;
			},
			label: () =>
				props().label ?? (owned() ? entry.group?.label() : null) ?? null,
			role: () =>
				props().role ?? (owned() ? entry.group?.role() : null) ?? null,
			pressed: () => props().pressed ?? null,
			focusable: () =>
				props().focusable ?? (owned() ? entry.group?.focusable() : undefined),
			focusOwner,
		};
		entries.set(node, entry);
		return entry;
	}

	/* -------------------------------------------- cached on the version */

	let flagsAt = -1;
	let flags = { drag: false, hover: false, drop: false, wheel: false };
	function readFlags() {
		ensure();
		if (flagsAt === builtAt) return flags;
		flagsAt = builtAt;
		flags = { drag: false, hover: false, drop: false, wheel: false };
		for (const record of records) {
			const handlers = record.handlers();
			if (handlers.drag !== undefined) flags.drag = true;
			if (handlers.drop !== undefined) flags.drop = true;
			if (handlers.onWheel !== undefined) flags.wheel = true;
			if (
				handlers.onEnter !== undefined ||
				handlers.onLeave !== undefined ||
				handlers.hover !== undefined ||
				record.cursor() !== null
			)
				flags.hover = true;
		}
		return flags;
	}

	let candidatesAt = -1;
	let candidateMap = new Map<number, HitCandidate>();
	/** The records with a hit area, and the matrix it was mapped through. */
	let mapped: { entry: Entry; matrix: Matrix }[] = [];
	function candidates(): ReadonlyMap<number, HitCandidate> {
		ensure();
		// A hit area rides its groups, and a group's move changes no prop of the
		// node, so it bumps nothing: the few records with an area are checked for
		// a new matrix. Records using their own geometry never are.
		if (
			candidatesAt === builtAt &&
			mapped.every((item) => item.entry.node.space.matrix === item.matrix)
		)
			return candidateMap;
		candidatesAt = builtAt;
		candidateMap = new Map();
		mapped = [];
		for (const entry of ordered) {
			const record = entry.record;
			const area = record.hitArea();
			let hitArea: Polyline | null = null;
			if (area) {
				const matrix = entry.node.space.matrix;
				mapped.push({ entry, matrix });
				hitArea = areaToScene(area, matrix);
			}
			candidateMap.set(record.id, {
				id: record.id,
				pointerEvents: record.pointerEvents(),
				hitArea,
			});
		}
		return candidateMap;
	}

	let focusableAt = -1;
	let tabStops: InteractionRecord[] = [];
	function focusable(): readonly InteractionRecord[] {
		ensure();
		if (focusableAt !== builtAt) {
			focusableAt = builtAt;
			tabStops = records.filter(isFocusable);
		}
		return tabStops;
	}

	let membersAt = -1;
	let members = new Map<number, InteractionRecord[]>();
	function membersOf(id: number): readonly InteractionRecord[] {
		ensure();
		if (membersAt !== builtAt) {
			membersAt = builtAt;
			members = new Map();
			const add = (owner: number, record: InteractionRecord) => {
				const list = members.get(owner);
				if (list) list.push(record);
				else members.set(owner, [record]);
			};
			for (const record of records) {
				add(record.id, record);
				const owner = record.focusOwner();
				if (owner !== null && owner !== record.id) add(owner, record);
			}
		}
		return members.get(id) ?? [];
	}

	return {
		version: { peek: version.peek, subscribe: version.subscribe },
		records: () => {
			ensure();
			return records;
		},
		candidates,
		find: (id) => {
			ensure();
			return byId.get(id);
		},
		hasDrag: () => readFlags().drag,
		hasHover: () => readFlags().hover,
		hasDrop: () => readFlags().drop,
		hasWheel: () => readFlags().wheel,
		focusable,
		membersOf,
		dispose() {
			for (const stop of unsubscribe) stop();
		},
	};
}

/**
 * Creates the focus channel for one scene. `createScene` does this for you;
 * it is exported for hosting a scene on your own canvas.
 *
 * @example
 * ```ts
 * import { createFocusChannel } from "@sophistry/core/internal";
 *
 * const focus = createFocusChannel();
 * focus.set(42, "keyboard");
 * focus.state.peek(); // { id: 42, source: "keyboard" }
 * ```
 *
 * @returns A {@link FocusChannel}: `state` to read, `set` to write. Starts with
 * nothing focused.
 *
 * @category Interaction plumbing
 */
export function createFocusChannel(): FocusChannel {
	// Equality by value rather than by reference, unlike the pointer channel:
	// a focus write is overwhelmingly the *same* focus being re-asserted (the
	// DOM's `focus` event echoing a write this made), and comparing here is
	// what stops that echo becoming a loop.
	const state = track<{ id: number | null; source: FocusSource }>(
		{ id: null, source: "script" },
		{ equals: (a, b) => a.id === b.id && a.source === b.source },
	);
	return {
		state: { peek: state.peek, subscribe: state.subscribe },
		set(id, source = "script") {
			state.set({ id, source });
		},
	};
}
