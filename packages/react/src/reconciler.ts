/**
 * The Sophistry reconciler: React's host config over the core scene graph.
 *
 * Host instances are scene nodes; the root container is `scene.root`.
 *
 * - **Create**: `createInstance(type, props)` looks the definition up in the
 *   catalogue (`wrap.ts`) and calls `definition.create(props)` without
 *   `children` and `ref`. A `Readable` prop binds in core.
 * - **Update**: `commitUpdate` walks the union of old and new keys and calls
 *   `node.set(key, value)` only for keys whose value changed (`Object.is`);
 *   a removed key is set to `undefined`. A `Readable` passed again is the
 *   same value, so nothing happens: a `Track` write never involves React.
 *   Keys the definition does not have are skipped with a warning, once.
 * - **Children**, two routes:
 *   - a definition with a `"children"`-kind prop (a group, a composite)
 *     keeps its React children in a list per instance; mutations edit the
 *     list and mark the parent, and `resetAfterCommit` writes each marked
 *     parent's list once (`node.set(childrenKey, list)`), so a commit that
 *     inserts, moves and removes many children costs one write per parent.
 *     The initial children are written in `finalizeInitialChildren`, before
 *     the node is attached (a composite's `setup` sees them);
 *   - a container without one, and the scene root, take `add(child, before)`
 *     and `remove(child)` directly, which leaves nodes added imperatively
 *     (`scene.add(...)`) alone.
 * - **Removal** disposes the removed subtree: at once in `removeChild`, and
 *   again (a no-op, dispose is idempotent) for every deleted host fiber in
 *   `detachDeletedInstance`, which also catches a composite's children that
 *   it never placed. React only reparents by unmounting and remounting, so
 *   no node moves between parents.
 * - **Text** is an error: text belongs in `<Label text=...>`.
 */

import type { ContainerNode, Definition, SceneNode } from "@sophistry/core";
import { instancesDefinition } from "@sophistry/core/internal";
import { createContext } from "react";
import createReconciler from "react-reconciler";
import {
	ContinuousEventPriority,
	DefaultEventPriority,
	DiscreteEventPriority,
	NoEventPriority,
} from "react-reconciler/constants";
import { type CatalogueEntry, catalogueEntry } from "./wrap";

/** Props React hands a host element. */
type Props = Record<string, unknown>;

/** What the reconciler keeps per node. */
interface InstanceRecord {
	readonly entry: CatalogueEntry;
	/**
	 * The React children in order, for a definition with a children prop;
	 * null for one that takes `add`/`remove` (or no children).
	 */
	readonly children: SceneNode[] | null;
}

const records = new WeakMap<SceneNode, InstanceRecord>();

/** Parents whose child list changed in the current commit. */
const dirtyParents = new Set<SceneNode>();

/** Keys React puts in a host element's props that are not node props. */
const RESERVED = new Set(["children", "ref", "key"]);

/**
 * Host props of `<Instances>` that are named differently on the node: React
 * takes `key` for itself, so the identity function arrives as `itemKey`.
 */
const INSTANCES_ALIASES: Readonly<Record<string, string>> = { itemKey: "key" };

/** The node prop a host prop writes: `key` for an `<Instances>`'s `itemKey`, else itself. */
function propName(entry: CatalogueEntry, key: string): string {
	return entry.definition === (instancesDefinition as unknown)
		? (INSTANCES_ALIASES[key] ?? key)
		: key;
}

/** `type + key` pairs already warned about. */
const warned = new Set<string>();

function warnOnce(id: string, message: string): void {
	if (warned.has(id)) return;
	warned.add(id);
	console.warn(message);
}

/** Display name of an instance for messages: `<Circle>`. */
function nameOf(entry: CatalogueEntry): string {
	return `<${entry.definition.name}>`;
}

function recordOf(node: SceneNode): InstanceRecord {
	const record = records.get(node);
	if (!record) {
		throw new Error(
			"Sophistry: a child of a Sophistry element must be a Sophistry element.",
		);
	}
	return record;
}

/** Whether `key` is a node prop of `entry`'s definition (warning once if it is not). */
function isNodeProp(entry: CatalogueEntry, key: string): boolean {
	if (RESERVED.has(key) || key === entry.childrenKey) return false;
	if (Object.hasOwn(entry.definition.descriptor, propName(entry, key)))
		return true;
	warnOnce(
		`${entry.type}\u0000${key}`,
		`Sophistry: ${nameOf(entry)} has no prop "${key}"; it is ignored.`,
	);
	return false;
}

/** Throws unless `parent` takes children. */
function assertTakesChildren(parent: InstanceRecord): void {
	if (!parent.entry.takesChildren) {
		throw new Error(
			`Sophistry: ${nameOf(parent.entry)} takes no children. Put the elements beside it, or in a <Group>.`,
		);
	}
}

/** Removes `child` from `list` if it is there. */
function without(list: SceneNode[], child: SceneNode): void {
	const at = list.indexOf(child);
	if (at >= 0) list.splice(at, 1);
}

/** Writes every marked parent's child list. */
function flushChildren(): void {
	if (dirtyParents.size === 0) return;
	const parents = [...dirtyParents];
	dirtyParents.clear();
	for (const parent of parents) writeChildren(parent);
}

function writeChildren(parent: SceneNode): void {
	const record = records.get(parent);
	if (!record?.children || parent.disposed) return;
	const key = record.entry.childrenKey as keyof object;
	(parent as SceneNode<Record<string, unknown>>).set(
		key,
		record.children.slice() as never,
	);
}

function appendTo(parent: SceneNode, child: SceneNode): void {
	const record = recordOf(parent);
	assertTakesChildren(record);
	if (record.children) {
		without(record.children, child);
		record.children.push(child);
		dirtyParents.add(parent);
	} else {
		(parent as ContainerNode).add(child);
	}
}

function insertInto(
	parent: SceneNode,
	child: SceneNode,
	before: SceneNode,
): void {
	const record = recordOf(parent);
	assertTakesChildren(record);
	if (record.children) {
		without(record.children, child);
		const at = record.children.indexOf(before);
		if (at < 0) record.children.push(child);
		else record.children.splice(at, 0, child);
		dirtyParents.add(parent);
	} else {
		(parent as ContainerNode).add(child, before);
	}
}

function removeFrom(parent: SceneNode, child: SceneNode): void {
	const record = recordOf(parent);
	if (record.children) {
		without(record.children, child);
		dirtyParents.add(parent);
	}
	child.dispose();
}

/** Hides a node for Suspense: `visible: false` where there is one, else `opacity: 0`. */
function hide(node: SceneNode): void {
	const { descriptor } = recordOf(node).entry.definition;
	const target = node as SceneNode<Record<string, unknown>>;
	if (Object.hasOwn(descriptor, "visible")) target.set("visible", false);
	else if (Object.hasOwn(descriptor, "opacity")) target.set("opacity", 0);
}

function unhide(node: SceneNode, props: Props): void {
	const { descriptor } = recordOf(node).entry.definition;
	const target = node as SceneNode<Record<string, unknown>>;
	if (Object.hasOwn(descriptor, "visible"))
		target.set("visible", props.visible);
	else if (Object.hasOwn(descriptor, "opacity"))
		target.set("opacity", props.opacity);
}

const textError = (text: string) =>
	new Error(
		`Sophistry: text ("${text.length > 40 ? `${text.slice(0, 40)}…` : text}") is not valid inside a <Stage>. Use <Label text="..."> for text in the scene, or render it outside the <Stage>.`,
	);

/** The host context: there is only one kind of place to be. */
const HOST_CONTEXT = {};

let currentUpdatePriority: number = NoEventPriority;

/** The priority of the DOM event being handled, as React DOM decides it. */
function eventPriority(): number {
	const event = typeof window === "undefined" ? undefined : window.event;
	switch (event?.type) {
		case "click":
		case "contextmenu":
		case "dblclick":
		case "pointercancel":
		case "pointerdown":
		case "pointerup":
		case "keydown":
		case "keyup":
		case "focusin":
		case "focusout":
		case "input":
		case "change":
			return DiscreteEventPriority;
		case "pointermove":
		case "pointerout":
		case "pointerover":
		case "pointerenter":
		case "pointerleave":
		case "wheel":
		case "scroll":
			return ContinuousEventPriority;
		default:
			return DefaultEventPriority;
	}
}

/**
 * The reconciler instance every `<Stage>` renders through.
 *
 * @internal
 */
export const reconciler = createReconciler<
	string, // Type
	Props, // Props
	ContainerNode, // Container
	SceneNode, // Instance
	never, // TextInstance
	never, // ActivityInstance
	never, // SuspenseInstance
	never, // HydratableInstance
	never, // FormInstance
	SceneNode, // PublicInstance
	object, // HostContext
	never, // ChildSet
	ReturnType<typeof setTimeout>, // TimeoutHandle
	-1, // NoTimeout
	null, // TransitionStatus
	null, // SuspendedState
	null, // RendererInspectionConfig
	never, // FormStateMarkerInstance
	never, // HoistableRoot
	never // Resource
>({
	rendererPackageName: "@sophistry/react",
	rendererVersion: "0.0.1",
	extraDevToolsConfig: null,
	supportsMutation: true,
	supportsPersistence: false,
	supportsHydration: false,
	isPrimaryRenderer: false,
	warnsIfNotActing: false,

	createInstance(type, props) {
		const entry = catalogueEntry(type);
		if (!entry) {
			throw new Error(
				`Sophistry: <${type}> is not a Sophistry element. Inside a <Stage>, render only components made by wrap() (Circle, Group, ...) and components that render them; DOM elements go outside the <Stage>.`,
			);
		}
		const initial: Props = {};
		for (const key of Object.keys(props)) {
			if (props[key] !== undefined && isNodeProp(entry, key))
				initial[propName(entry, key)] = props[key];
		}
		const create = (entry.definition as Definition<Props>).create as (
			props: Props,
		) => SceneNode;
		const node = create(initial);
		records.set(node, {
			entry,
			children: entry.childrenKey === undefined ? null : [],
		});
		return node;
	},
	createTextInstance(text) {
		throw textError(text);
	},
	appendInitialChild(parent, child) {
		const record = recordOf(parent);
		assertTakesChildren(record);
		if (record.children) record.children.push(child);
		else (parent as ContainerNode).add(child);
	},
	finalizeInitialChildren(instance) {
		// Before the node is attached anywhere: a composite's `setup` sees them.
		if (recordOf(instance).children?.length) writeChildren(instance);
		return false;
	},
	shouldSetTextContent: () => false,
	getRootHostContext: () => HOST_CONTEXT,
	getChildHostContext: () => HOST_CONTEXT,
	getPublicInstance: (instance) => instance,
	prepareForCommit: () => null,
	resetAfterCommit: flushChildren,
	preparePortalMount() {},
	scheduleTimeout: setTimeout,
	cancelTimeout: clearTimeout,
	noTimeout: -1,
	supportsMicrotasks: true,
	scheduleMicrotask: queueMicrotask,
	getInstanceFromNode: () => null,
	beforeActiveInstanceBlur() {},
	afterActiveInstanceBlur() {},
	prepareScopeUpdate() {},
	getInstanceFromScope: () => null,
	detachDeletedInstance(node) {
		node.dispose();
		dirtyParents.delete(node);
	},

	appendChild: appendTo,
	appendChildToContainer(container, child) {
		container.add(child);
	},
	insertBefore: insertInto,
	insertInContainerBefore(container, child, before) {
		container.add(child, before as SceneNode);
	},
	removeChild: (parent, child) => removeFrom(parent, child as SceneNode),
	removeChildFromContainer(container, child) {
		container.remove(child as SceneNode);
		(child as SceneNode).dispose();
	},
	commitUpdate(instance, _type, oldProps, newProps) {
		const { entry } = recordOf(instance);
		const node = instance as SceneNode<Record<string, unknown>>;
		for (const key of Object.keys(newProps)) {
			if (Object.is(oldProps[key], newProps[key])) continue;
			if (isNodeProp(entry, key)) node.set(propName(entry, key), newProps[key]);
		}
		for (const key of Object.keys(oldProps)) {
			if (key in newProps || oldProps[key] === undefined) continue;
			if (isNodeProp(entry, key)) node.set(propName(entry, key), undefined);
		}
	},
	commitMount() {},
	hideInstance: hide,
	unhideInstance: unhide,
	hideTextInstance() {},
	unhideTextInstance() {},
	// The root may hold nodes added imperatively (`scene.add`); React never
	// owned them, so it does not clear them.
	clearContainer() {},
	resetTextContent() {},
	commitTextUpdate() {},

	NotPendingTransition: null,
	HostTransitionContext: createContext<null>(null),
	setCurrentUpdatePriority(priority) {
		currentUpdatePriority = priority;
	},
	getCurrentUpdatePriority: () => currentUpdatePriority,
	resolveUpdatePriority: () =>
		currentUpdatePriority !== NoEventPriority
			? currentUpdatePriority
			: eventPriority(),
	resetFormInstance() {},
	requestPostPaintCallback() {},
	shouldAttemptEagerTransition: () => false,
	trackSchedulerEvent() {},
	resolveEventType: () =>
		typeof window === "undefined" ? null : (window.event?.type ?? null),
	resolveEventTimeStamp: () =>
		typeof window === "undefined" ? -1.1 : (window.event?.timeStamp ?? -1.1),
	maySuspendCommit: () => false,
	maySuspendCommitOnUpdate: () => false,
	maySuspendCommitInSyncRender: () => false,
	preloadInstance: () => true,
	startSuspendingCommit: () => null,
	suspendInstance() {},
	suspendOnActiveViewTransition() {},
	waitForCommitToBeReady: () => null,
	getSuspendedCommitReason: () => null,
	bindToConsole: (methodName, args) =>
		(console[methodName as keyof Console] as (...data: unknown[]) => void).bind(
			console,
			...args,
		),
});
