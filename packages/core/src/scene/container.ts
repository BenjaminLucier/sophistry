/**
 * The container base: a node with children, a space it hands them and the
 * context values it provides.
 *
 * Children are kept in tree order, which is z-tie paint order and tab order.
 * Reconciliation is by identity only (`setChildren` keeps, moves, attaches
 * and disposes); there is no virtual tree. A container that changes the
 * space (a group) recomputes `childSpace` in its `SPACE` stage and tells its
 * children which fields changed; one that does not (the base default, and
 * composites) hands its own space through untouched and forwards changes.
 */

import { unionBounds } from "../geometry/bounds.js";
import type { Bounds } from "../geometry/index.js";
import type { SceneGraph } from "./graph.js";
import { ANY_CONTEXT, BaseNode } from "./node.js";
import type {
	ContainerNode,
	ContextKey,
	InvalidateBits,
	PropDescriptor,
	SceneNode,
	Space,
} from "./types.js";

/** Bumped by every `setChildren`; see there. */
let reconcileEpoch = 0;

/** Narrows a public node to the base class every node extends. */
function asNode(node: SceneNode): BaseNode {
	if (!(node instanceof BaseNode)) {
		throw new TypeError("Scene children must be nodes made by a definition.");
	}
	return node;
}

/**
 * The base class of every container node.
 *
 * @typeParam P - The container's props.
 *
 * @category Scene graph
 */
export abstract class BaseContainer<P extends object = object>
	extends BaseNode<P>
	implements ContainerNode<P>
{
	/** @internal The children, in tree order. */
	childNodes: BaseNode[] = [];
	private provided: Map<ContextKey<unknown>, unknown> | null = null;

	get children(): readonly SceneNode[] {
		return this.childNodes;
	}

	/**
	 * The space handed to the children. Default: this container's own space
	 * (a container that does not transform). Groups override it.
	 */
	get childSpace(): Space {
		return this.space;
	}

	override get providedValues(): Map<ContextKey<unknown>, unknown> | null {
		return this.provided;
	}

	/* ----------------------------------------------------------- children */

	setChildren(children: readonly SceneNode[]): void {
		if (this.disposed) return;
		// Membership is tracked by stamping each new child with this call's
		// epoch rather than with a `Set`: a reshuffle of ten thousand children
		// spent a fifth of its time hashing them into one. The epoch is held
		// locally, so a nested reconciliation (a dispose handler) cannot
		// confuse this one.
		const epoch = ++reconcileEpoch;
		const previous = this.childNodes;
		const next: BaseNode[] = new Array(children.length);
		let unchanged = children.length === previous.length;
		for (let i = 0; i < children.length; i++) {
			const child = asNode(children[i] as SceneNode);
			if (child.reconcileMark === epoch) {
				throw new Error(
					`${this.type}: the same node appears twice in children.`,
				);
			}
			child.reconcileMark = epoch;
			next[i] = child;
			if (unchanged && child !== previous[i]) unchanged = false;
		}
		if (unchanged) return;
		this.childNodes = next;
		for (const child of previous) {
			if (child.reconcileMark !== epoch && child.parentNode === this) {
				child.disposeTree();
			}
		}
		for (const child of next) {
			if (child.parentNode !== this) this.adopt(child);
		}
		this.graph?.structureChanged();
	}

	add<N extends SceneNode>(child: N, before: SceneNode | null = null): N {
		if (this.disposed) return child;
		const node = asNode(child);
		if (node === (this as BaseNode))
			throw new Error("A node cannot contain itself.");
		if (node.parentNode === this) {
			const at = this.childNodes.indexOf(node);
			this.childNodes.splice(at, 1);
		}
		const index = before ? this.childNodes.indexOf(asNode(before)) : -1;
		if (index < 0) this.childNodes.push(node);
		else this.childNodes.splice(index, 0, node);
		if (node.parentNode !== this) this.adopt(node);
		this.graph?.structureChanged();
		return child;
	}

	remove(child: SceneNode): void {
		const node = asNode(child);
		if (node.parentNode !== this) return;
		node.dispose();
	}

	/** Takes `node` from wherever it was (without disposing it) and attaches it here. */
	private adopt(node: BaseNode): void {
		for (
			let ancestor: BaseNode | null = this;
			ancestor;
			ancestor = ancestor.parentNode
		) {
			if (ancestor === node)
				throw new Error("A node cannot contain its ancestor.");
		}
		const from = node.parentNode;
		if (from) from.release(node);
		node.parentNode = this;
		if (node.graph !== this.graph) {
			if (node.graph) node.detach();
			if (this.graph) node.attach(this.graph);
		}
		node.reparented();
	}

	/**
	 * @internal Drops `node` from the children without disposing it (it is
	 * being disposed or moved).
	 */
	release(node: BaseNode): void {
		const at = this.childNodes.indexOf(node);
		if (at >= 0) {
			this.childNodes = this.childNodes.slice();
			this.childNodes.splice(at, 1);
		}
		node.parentNode = null;
		this.graph?.structureChanged();
	}

	protected override propChanged<K extends keyof P>(
		key: K,
		descriptor: PropDescriptor<P[K]>,
	): void {
		if (descriptor.kind === "children") {
			const value = this.props[key] as readonly SceneNode[] | undefined;
			this.setChildren(value ?? []);
			return;
		}
		super.propChanged(key, descriptor);
	}

	/* ------------------------------------------------------------ context */

	provide<T>(key: ContextKey<T>, value: T): void {
		this.provided ??= new Map();
		const had = this.provided.has(key);
		if (had && Object.is(this.provided.get(key), value)) return;
		this.provided.set(key, value);
		for (const child of this.childNodes) child.contextChanged(key);
	}

	override contextChanged(key: ContextKey<unknown>): void {
		// A key this container provides itself shadows the change for its subtree.
		if (key !== ANY_CONTEXT && this.provided?.has(key)) return;
		super.contextChanged(key);
		for (const child of this.childNodes) child.contextChanged(key);
	}

	/**
	 * Default for a container that does not change the space: forward the
	 * change to the children. A group overrides this to recompute first.
	 */
	override spaceChanged(change: number): void {
		super.spaceChanged(change);
		for (const child of this.childNodes) child.spaceChanged(change);
	}

	/* -------------------------------------------------------------- graph */

	override attach(graph: SceneGraph): void {
		super.attach(graph);
		for (const child of this.childNodes) child.attach(graph);
	}

	override detach(): void {
		for (const child of this.childNodes) child.detach();
		super.detach();
	}

	protected override disposeContents(): void {
		const children = this.childNodes;
		this.childNodes = [];
		for (const child of children) child.disposeTree();
	}

	/** A plain container has no stages of its own. */
	protected run(_dirty: InvalidateBits): void {}

	/* ------------------------------------------------------------ handles */

	/** The union of the children's boxes. */
	override bounds(): Bounds | null {
		this.refresh();
		return unionBounds(...this.childNodes.map((child) => child.bounds()));
	}

	/** For a container, the same as {@link BaseContainer.bounds}. */
	override localBounds(): Bounds | null {
		return this.bounds();
	}
}
