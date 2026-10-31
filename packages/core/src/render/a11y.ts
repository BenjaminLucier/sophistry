/**
 * The accessibility mirror: a visually hidden overlay in the scene's host with
 * one transparent, focusable element per focusable node, positioned over its
 * box (scene bounds through the camera to CSS pixels). The canvas is
 * `aria-hidden`.
 *
 * Real DOM elements give real tab order, screen-reader output, `:focus-visible`
 * and assistive-tech gestures. The focus list is the interaction registry,
 * filtered; focus state lives in the scene's `FocusChannel`.
 *
 * Plain DOM, no framework: every input is a `Readable` or a getter, a change
 * only marks the mirror stale, and the DOM is brought up to date once, in the
 * paint phase of the frame (after the commit that produced the snapshot).
 */

import type { Bounds, Point } from "../geometry";
import type { Matrix } from "../geometry/transform";
import { applyToPoint, compose, invert } from "../geometry/transform";
import { isYUp } from "../geometry/view-matrix";
import { boundsOfNodes, indexSpecs } from "../interact/hit";
import {
	ITEM_KEYS,
	itemCenter,
	itemCount,
	itemPosition,
	stepItem,
} from "../interact/item-order";
import type { FocusChannel, InteractionRegistry } from "../interact/registry";
import type {
	InteractionRecord,
	KeyboardBehaviour,
	ScenePointerEvent,
} from "../interact/types";
import type { Readable } from "../reactive";
import type { DrawSpec } from "../spec/types";
import { requestFrame } from "../tween/frame-loop";
import type { CameraView } from "./camera";
import { cameraMatrix, viewportBox } from "./camera";

/**
 * The nodes the focus ring should wrap: the focused node and the rest of its
 * interaction group, or null when nothing is focused or the focus is not
 * *visible*, i.e. it was last moved by a pointer rather than a key.
 *
 * Ids rather than a box, deliberately. The box has to come from the snapshot,
 * and the renderer is what holds the snapshot: it is handed the one thing that
 * changes only when focus does, and measures the box itself, at paint time,
 * from the snapshot it already has. Call it again whenever `focus.state` or
 * `registry.version` goes stale, and hand the result to `renderer.setFocus`.
 *
 * @param registry - The scene's interaction registry, for group membership.
 * @param focus - The scene's focus channel.
 * @returns The node ids to ring (the renderer's `setFocus`), or null when no
 * ring should show.
 *
 * @category Interaction plumbing
 */
export function focusIds(
	registry: InteractionRegistry,
	focus: FocusChannel,
): number[] | null {
	const { id, source } = focus.state.peek();
	if (id === null || source !== "keyboard") return null;
	return registry.membersOf(id).map((record) => record.id);
}

/**
 * What the mirror needs from the pointer driver: the two things a key press
 * stands in for that only the driver knows. The driver's own `pick` and
 * `cancel` have exactly these shapes.
 *
 * @category Interaction plumbing
 */
export interface AccessibilityDriver {
	/**
	 * The topmost interactive node at a canonical-pixel point (converted to
	 * scene units through the stage's own framing), ignoring the node id
	 * `exclude`; `null` if none. Backs `ScenePointerEvent.pick` on the events
	 * the mirror synthesises for Enter, Space and an item list's keys.
	 */
	pick(at: Point, exclude?: number | null): number | null;
	/**
	 * Ends any gesture in flight that began on node `id` as **cancelled**:
	 * Escape's meaning. Returns whether there was one to cancel.
	 */
	cancel(id?: number | null): boolean;
}

/**
 * The item the keyboard is on within a batched node.
 *
 * @category Interaction plumbing
 */
export interface FocusItem {
	/** The node. */
	id: number;
	/** Its item, as `ScenePointerEvent.item` numbers them. */
	item: number;
}

/**
 * Options for {@link createAccessibilityMirror}. Every changing input is a
 * `Readable`: the mirror subscribes, marks itself stale and re-reads with
 * `peek()` in the next paint phase.
 *
 * @category Interaction plumbing
 */
export interface AccessibilityMirrorOptions {
	/**
	 * The scene's host element: the mirror's overlay is appended to it and
	 * placed with `position: absolute; inset: 0`, so the host should be the
	 * `position: relative` box the canvas fills.
	 */
	host: HTMLElement;
	/**
	 * The interaction registry; its focusable records become the mirror's
	 * elements. A bump of `version` re-reads every record: membership, order,
	 * handlers, and the `label`, `role` and `pressed` getters.
	 */
	registry: InteractionRegistry;
	/** The focus channel kept in step with real DOM focus, both ways. */
	focus: FocusChannel;
	/**
	 * The renderer's z-sorted snapshot (what it was last handed with
	 * `setFrame`): where the boxes come from. Must go stale whenever a new frame
	 * is handed over.
	 */
	snapshot: Readable<readonly DrawSpec[]>;
	/** Backing-store size in device pixels. */
	size: Readable<{ width: number; height: number }>;
	/**
	 * The stage's own view matrix (scene units → device pixels): the view of a
	 * single-camera scene, and the definition of the `canonical` pixels
	 * synthesised events report.
	 */
	canonicalView: Readable<Matrix>;
	/** Camera views, in paint order. Omitted or empty is the single-view path. */
	cameraViews?: Readable<readonly CameraView[]>;
	/** Device pixels per CSS pixel, to convert backing-store pixels to CSS pixels. */
	dpr: Readable<number>;
	/**
	 * The pointer driver, for `pick` and for Escape's cancel. A getter, so a
	 * driver attached after the mirror (or never) is fine; null meanwhile.
	 */
	driver?: () => AccessibilityDriver | null;
	/**
	 * Receives the current item of a focused batched node (see
	 * `InteractionHandlers.itemLabel`) as it moves, or null; forward it to
	 * `renderer.setFocusItem` so the ring wraps that item rather than the node.
	 */
	onItem?: (current: FocusItem | null) => void;
}

/**
 * What {@link createAccessibilityMirror} returns.
 *
 * @category Interaction plumbing
 */
export interface AccessibilityMirror {
	/** The overlay element inside the host; the mirror elements are its children. */
	readonly element: HTMLElement;
	/** Removes the overlay and every element, and drops every subscription. */
	dispose(): void;
}

/** Present to assistive technology, absent from the picture. */
const VISUALLY_HIDDEN =
	"position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;";

/** A mirror's item-list ids are unique on the page through this counter. */
let mirrorCount = 0;

/** One mirror element's placement, resolved for a frame. */
interface Placement {
	/** CSS pixels, relative to the host element. */
	left: number;
	top: number;
	width: number;
	height: number;
	/** Which camera it was resolved through, or -1 on a single-view scene. */
	camera: number;
	/** Scene units: where a synthesised activation happens. */
	center: Point;
}

/** One focusable node's element and what it was last resolved to. */
interface Entry {
	record: InteractionRecord;
	element: HTMLElement;
	/** The item list's one option, while the node is a list. */
	option: HTMLElement | null;
	placement: Placement;
}

/** One camera, resolved for a frame: its viewport and its matrix. */
interface ResolvedView {
	index: number;
	box: { x: number; y: number; width: number; height: number };
	matrix: Matrix;
	yUp: boolean;
}

/** The AABB of a box mapped through a matrix. */
function mapBounds(box: Bounds, matrix: Matrix): Bounds {
	const corners = [
		applyToPoint(matrix, { x: box.minX, y: box.minY }),
		applyToPoint(matrix, { x: box.maxX, y: box.minY }),
		applyToPoint(matrix, { x: box.maxX, y: box.maxY }),
		applyToPoint(matrix, { x: box.minX, y: box.maxY }),
	];
	return {
		minX: Math.min(...corners.map((point) => point.x)),
		minY: Math.min(...corners.map((point) => point.y)),
		maxX: Math.max(...corners.map((point) => point.x)),
		maxY: Math.max(...corners.map((point) => point.y)),
	};
}

/** A matrix's linear part applied to a direction: a delta, not a position. */
function mapDirection(matrix: Matrix, direction: Point): Point {
	const x = matrix.a * direction.x + matrix.c * direction.y;
	const y = matrix.b * direction.x + matrix.d * direction.y;
	const length = Math.hypot(x, y);
	return length > 0 ? { x: x / length, y: y / length } : { x: 0, y: 0 };
}

const ARROWS: Record<string, Point> = {
	// Device pixels, where y runs down. The stage's own convention is not
	// consulted here on purpose: `ArrowUp` means up *on screen*, and turning that
	// into the node's units is the inverse matrix's job below.
	ArrowLeft: { x: -1, y: 0 },
	ArrowRight: { x: 1, y: 0 },
	ArrowUp: { x: 0, y: -1 },
	ArrowDown: { x: 0, y: 1 },
};

/** What a node's keyboard behaviour advertises: the arrows when it nudges, plus its own keys. */
function keyShortcuts(
	keyboard: KeyboardBehaviour | undefined,
): string | undefined {
	if (!keyboard) return undefined;
	const keys = [
		keyboard.nudge ? "ArrowUp ArrowDown ArrowLeft ArrowRight" : "",
		keyboard.shortcuts ?? "",
	]
		.filter((part) => part !== "")
		.join(" ");
	return keys || undefined;
}

/** A toggle's `aria-pressed`, or no attribute for a node that is not a toggle. */
function pressedState(pressed: boolean | null | undefined): string | undefined {
	return pressed == null ? undefined : pressed ? "true" : "false";
}

/**
 * Every record sharing each focus owner's group, the owner included, in one
 * pass over the records rather than one `membersOf` filter per tab stop.
 */
function groupMembers(
	records: readonly InteractionRecord[],
): Map<number, InteractionRecord[]> {
	const members = new Map<number, InteractionRecord[]>();
	const add = (owner: number, record: InteractionRecord) => {
		const group = members.get(owner);
		if (group) group.push(record);
		else members.set(owner, [record]);
	};
	for (const record of records) {
		add(record.id, record);
		const owner = record.focusOwner();
		if (owner !== null && owner !== record.id) add(owner, record);
	}
	return members;
}

/** Sets or removes an attribute, touching the DOM only on a change. */
function writeAttribute(
	element: HTMLElement,
	name: string,
	value: string | undefined,
): void {
	if (value === undefined) {
		if (element.hasAttribute(name)) element.removeAttribute(name);
	} else if (element.getAttribute(name) !== value) {
		element.setAttribute(name, value);
	}
}

/**
 * Creates the DOM overlay that makes interactive nodes reachable by keyboard
 * and assistive technology. One focusable element per focusable node, in tree
 * order (the registry's order, so tab order is tree order), announced by
 * `label` and `role`. Tab moves between nodes, arrows nudge, Shift+arrow
 * fine-nudges, Enter or Space activates, Escape cancels a drag; a behaviour's
 * `key` hears any key first. A batched node with `itemLabel` is a listbox
 * whose arrow keys walk a current item.
 *
 * @param options - See {@link AccessibilityMirrorOptions}.
 * @returns The overlay and its `dispose`.
 * @see {@link https://sophistry.dev/guides/accessibility/}
 * @category Interaction plumbing
 */
export function createAccessibilityMirror(
	options: AccessibilityMirrorOptions,
): AccessibilityMirror {
	const { registry, focus } = options;
	const idPrefix = `sophistry-items-${++mirrorCount}`;
	const entries = new Map<number, Entry>();
	/**
	 * The keyboard's current item within a batched node, if any. One for the
	 * mirror, since only the focused element has one.
	 */
	let current: FocusItem | null = null;
	/** Whether the elements need re-placing (anything but focus changed). */
	let layoutStale = true;
	/** Whether DOM focus needs bringing in step with the channel. */
	let focusStale = false;
	/**
	 * True while elements are being moved or removed: the `blur` that moving a
	 * focused node in the DOM causes is housekeeping, not the user leaving.
	 */
	let reconciling = false;
	let disposed = false;

	// Not `aria-hidden`, and not `display: none` or `visibility: hidden`: either
	// would take the children out of the tab order, which is the one thing they
	// exist for. Invisible here means "paints nothing": the elements are empty
	// and transparent, and the canvas shows through.
	const overlay = document.createElement("div");
	overlay.style.position = "absolute";
	overlay.style.inset = "0";
	// The canvas must keep every gesture. Focus still follows a press, because
	// the driver publishes it; routing presses through these elements instead
	// would mean re-implementing hit testing in the DOM against boxes, which is
	// exactly the approximation `hit.ts` refuses.
	overlay.style.pointerEvents = "none";
	options.host.append(overlay);

	/** The snapshot by node id, rebuilt only when the snapshot is a new array. */
	let indexed: readonly DrawSpec[] | null = null;
	let index = new Map<number, DrawSpec>();
	function specIndex(): Map<number, DrawSpec> {
		const snapshot = options.snapshot.peek();
		if (snapshot !== indexed) {
			indexed = snapshot;
			index = indexSpecs(snapshot);
		}
		return index;
	}

	/**
	 * Scene units → device pixels, per camera, plus the viewport each one
	 * occupies, resolved at the last reconcile. One place, so the mirror and the
	 * painter cannot disagree.
	 */
	let views: ResolvedView[] = [];
	function resolveViews(): ResolvedView[] {
		const list = options.cameraViews?.peek() ?? [];
		const size = options.size.peek();
		return list.map((view, viewIndex) => ({
			index: viewIndex,
			box: viewportBox(view.viewport, size),
			matrix: cameraMatrix(view, size),
			yUp: view.yUp,
		}));
	}

	/** The view a node is drawn through: its camera's, or the stage's. */
	const viewOf = (placement: Placement): Matrix =>
		views[placement.camera]?.matrix ?? options.canonicalView.peek();

	/**
	 * Where each focusable node's element goes.
	 *
	 * Recomputed whenever the snapshot changes (i.e. whenever anything in the
	 * scene moves), which is right and is also why it walks the *focusable*
	 * records rather than the scene: a handful of boxes per frame, on the same
	 * order as the hit-test candidate map.
	 *
	 * **Which camera.** With several cameras a node is visible through several
	 * views at once, but a DOM element has one position, so one has to be
	 * chosen. It is the **topmost camera whose viewport contains the node's
	 * centre**, the last registered, exactly `pickCamera`'s rule for the
	 * pointer. Choosing anything else would put the AT cursor and the mouse in
	 * different panes. A node no camera shows gets no element at all, and so is
	 * not a tab stop: it is not on screen, and a tab stop you cannot see is
	 * worse than one you cannot reach.
	 */
	function placements(
		focusable: readonly InteractionRecord[],
	): Map<number, Placement> {
		const out = new Map<number, Placement>();
		if (focusable.length === 0) return out;
		const specs = specIndex();
		const size = options.size.peek();
		const dpr = options.dpr.peek();
		const canonical = options.canonicalView.peek();
		// Only a text run's box depends on the view's y direction; the stage's
		// own is used to pick the camera, and the chosen camera's to place it.
		const stageYUp = isYUp(canonical);
		const groups = groupMembers(registry.records());

		for (const record of focusable) {
			const ids = (groups.get(record.id) ?? [record]).map(
				(member) => member.id,
			);
			let sceneBox = boundsOfNodes(ids, specs, stageYUp);
			if (!sceneBox) continue;

			const center = {
				x: (sceneBox.minX + sceneBox.maxX) / 2,
				y: (sceneBox.minY + sceneBox.maxY) / 2,
			};

			let matrix = canonical;
			let camera = -1;
			if (views.length > 0) {
				let found: ResolvedView | undefined;
				for (let viewIndex = views.length - 1; viewIndex >= 0; viewIndex--) {
					const view = views[viewIndex];
					const at = applyToPoint(view.matrix, center);
					if (
						view.box.width > 0 &&
						view.box.height > 0 &&
						at.x >= view.box.x &&
						at.x < view.box.x + view.box.width &&
						at.y >= view.box.y &&
						at.y < view.box.y + view.box.height
					) {
						found = view;
						break;
					}
				}
				if (!found) continue;
				matrix = found.matrix;
				camera = found.index;
				if (found.yUp !== stageYUp) {
					sceneBox = boundsOfNodes(ids, specs, found.yUp) ?? sceneBox;
				}
			}

			// Device pixels → CSS pixels. The ratio in force is the backing store
			// over the CSS box, but reading the element's rect here would be a
			// layout flush on every frame of every animation; `dpr` is the same
			// number in the steady state, and the frame or two after a resize where
			// it isn't costs a slightly misplaced mirror rather than a misplaced
			// click, which is why the driver, where a few pixels do matter, pays
			// for the rect and this does not.
			const device = mapBounds(sceneBox, matrix);
			// Entirely off the canvas is off screen, and off screen is not a tab
			// stop: the same judgement as "no camera shows it".
			if (device.maxX < 0 || device.maxY < 0) continue;
			if (device.minX > size.width || device.minY > size.height) continue;

			out.set(record.id, {
				camera,
				center,
				left: device.minX / dpr,
				top: device.minY / dpr,
				width: Math.max(1, (device.maxX - device.minX) / dpr),
				height: Math.max(1, (device.maxY - device.minY) / dpr),
			});
		}
		return out;
	}

	/** Whether a node is shown as a list of items (a batched node with `itemLabel`). */
	function isListed(record: InteractionRecord): boolean {
		const spec = specIndex().get(record.id);
		return (
			record.handlers().itemLabel !== undefined &&
			spec !== undefined &&
			itemCount(spec) > 0
		);
	}

	/** The current item of node `id`, or null. */
	const itemOf = (id: number): number | null =>
		current && current.id === id ? current.item : null;

	/** Writes an entry's attributes, style and option from its record and placement. */
	function renderEntry(entry: Entry): void {
		const { record, element, placement } = entry;
		const handlers = record.handlers();
		const listed = isListed(record);
		const optionId = `${idPrefix}-${record.id}`;
		const item = itemOf(record.id);

		// `"button"` by default even for a draggable handle. ARIA has no role for
		// "thing you drag": `aria-grabbed` is deprecated and nothing implements
		// it, and `role="slider"` promises one axis and a value AT will ask for
		// and we cannot always supply. A button that arrow keys move is what the
		// platform patterns actually converge on; `role` overrides it where a node
		// knows better (`"slider"` on a real one-dimensional handle, say).
		writeAttribute(
			element,
			"role",
			record.role() ?? (listed ? "listbox" : "button"),
		);
		writeAttribute(element, "aria-label", record.label() ?? undefined);
		// A batched node is a list of its items, walked by key: the one option
		// below is always the current item.
		writeAttribute(
			element,
			"aria-activedescendant",
			listed && item !== null ? optionId : undefined,
		);
		// A string: `false` is a state ("not pressed"), not an absent attribute.
		writeAttribute(element, "aria-pressed", pressedState(record.pressed?.()));
		writeAttribute(
			element,
			"aria-keyshortcuts",
			listed ? ITEM_KEYS.join(" ") : keyShortcuts(handlers.keyboard),
		);

		const style = element.style;
		const left = `${placement.left}px`;
		const top = `${placement.top}px`;
		const width = `${placement.width}px`;
		const height = `${placement.height}px`;
		if (style.left !== left) style.left = left;
		if (style.top !== top) style.top = top;
		if (style.width !== width) style.width = width;
		if (style.height !== height) style.height = height;

		if (!listed) {
			entry.option?.remove();
			entry.option = null;
			return;
		}
		if (!entry.option) {
			const option = document.createElement("div");
			option.id = optionId;
			option.setAttribute("role", "option");
			option.setAttribute("aria-selected", "true");
			option.setAttribute("style", VISUALLY_HIDDEN);
			element.append(option);
			entry.option = option;
		}
		const option = entry.option;
		const spec = specIndex().get(record.id);
		writeAttribute(
			option,
			"aria-setsize",
			spec ? String(itemCount(spec)) : undefined,
		);
		const place =
			item === null || !spec
				? null
				: itemPosition(spec, item, viewOf(placement));
		writeAttribute(
			option,
			"aria-posinset",
			place === null ? undefined : String(place),
		);
		const text = item === null ? "" : (handlers.itemLabel?.(item) ?? "");
		if (option.textContent !== text) option.textContent = text;
	}

	/** Creates the element for a newly focusable node, with its listeners. */
	function createEntry(record: InteractionRecord, placement: Placement): Entry {
		const element = document.createElement("div");
		element.dataset.visFocus = "true";
		element.tabIndex = 0;
		element.style.position = "absolute";
		// The focus indicator is painted on the canvas as chrome, in the theme's
		// accent and at a CSS-pixel width, so the browser's own outline would be
		// a second, differently-styled ring on top of ours.
		element.style.outline = "none";
		const entry: Entry = { record, element, option: null, placement };

		element.addEventListener("focus", () => {
			// Only a *change* of id counts as a keyboard move. Focus that merely
			// echoes a write the mirror just made (after a press) leaves the
			// source as the driver set it, which is the whole `:focus-visible`
			// distinction.
			if (focus.state.peek().id !== entry.record.id) {
				focus.set(entry.record.id, "keyboard");
			}
		});
		element.addEventListener("blur", (event) => {
			if (reconciling) return;
			if (itemOf(entry.record.id) !== null) moveItem(entry, null, event);
			const state = focus.state.peek();
			if (state.id === entry.record.id) focus.set(null, state.source);
		});
		element.addEventListener("keydown", (event) => onKeyDown(entry, event));
		return entry;
	}

	/**
	 * Brings the elements in step with the registry and the snapshot: one per
	 * placed focusable record, in tree order, at its box.
	 *
	 * Keyed on node id, so an element survives every frame its node stays a tab
	 * stop: the placements change every frame, and rebuilding elements from
	 * them would lose DOM focus each time.
	 */
	function reconcile(): void {
		views = resolveViews();
		const focusable = registry.focusable();
		const placed = placements(focusable);
		const active = document.activeElement;
		reconciling = true;
		try {
			for (const [id, entry] of entries) {
				if (placed.has(id)) continue;
				// Gone or off screen. A current item there is left, as a blur would.
				if (current?.id === id) moveItem(entry, null, new Event("blur"));
				entry.element.remove();
				entries.delete(id);
			}
			// Walk the wanted order with a cursor over the overlay's children,
			// moving an element only when it is out of place, so a reorder that
			// leaves the focused element where it was does not touch it.
			let cursor = overlay.firstElementChild;
			for (const record of focusable) {
				const placement = placed.get(record.id);
				if (!placement) continue;
				let entry = entries.get(record.id);
				if (entry) {
					entry.record = record;
					entry.placement = placement;
				} else {
					entry = createEntry(record, placement);
					entries.set(record.id, entry);
				}
				if (current?.id === record.id && !isListed(record)) {
					moveItem(entry, null, new Event("blur"));
				}
				renderEntry(entry);
				if (entry.element === cursor) {
					cursor = cursor.nextElementSibling;
				} else {
					overlay.insertBefore(entry.element, cursor);
				}
			}
			// Moving a node in the DOM drops its focus; put it back.
			if (
				active instanceof HTMLElement &&
				active !== document.activeElement &&
				overlay.contains(active)
			) {
				active.focus({ preventScroll: true });
			}
		} finally {
			reconciling = false;
		}
	}

	/**
	 * DOM focus follows scene focus.
	 *
	 * The other direction is the `focus` listener above, and between them there
	 * is one source of truth: the channel. A press on the canvas writes the
	 * channel (the driver does it), this moves the browser, and the resulting
	 * `focus` event finds the id already correct and leaves the *source* alone,
	 * which is how a mouse press avoids drawing a keyboard focus ring while a
	 * Tab, which necessarily arrives on a different id, still does.
	 */
	function syncFocus(): void {
		const { id } = focus.state.peek();
		const element = id === null ? null : entries.get(id)?.element;
		const active = document.activeElement;
		if (element) {
			// `preventScroll`, because a press on a shape must not scroll the page
			// to it: it is already under the user's finger.
			if (active !== element) element.focus({ preventScroll: true });
		} else if (active instanceof HTMLElement && overlay.contains(active)) {
			active.blur();
		}
	}

	/** The paint-phase update: re-place the elements, then move DOM focus. */
	function update(): void {
		if (disposed) return;
		if (layoutStale) {
			layoutStale = false;
			reconcile();
		}
		if (focusStale) {
			focusStale = false;
			syncFocus();
		}
	}

	const markLayout = () => {
		layoutStale = true;
		requestFrame("paint", update);
	};
	const markFocus = () => {
		focusStale = true;
		requestFrame("paint", update);
	};
	const unsubscribes = [
		registry.version.subscribe(markLayout),
		options.snapshot.subscribe(markLayout),
		options.size.subscribe(markLayout),
		options.canonicalView.subscribe(markLayout),
		options.dpr.subscribe(markLayout),
		focus.state.subscribe(markFocus),
	];
	if (options.cameraViews) {
		unsubscribes.push(options.cameraViews.subscribe(markLayout));
	}

	/**
	 * The event Enter and Space stand in for.
	 *
	 * There is no pointer, so the honest thing is to say where the *node* is
	 * rather than invent a cursor: every position is the centre of the node's
	 * own box, resolved properly into all three spaces. A handler that asks
	 * "where was I tapped?" therefore gets "in the middle of you", which is the
	 * only answer a key press supports. `native` is the real `KeyboardEvent`,
	 * cast: the fields a handler actually reaches for (the modifier keys,
	 * `preventDefault`, `target`, `timeStamp`) are all genuinely there, and the
	 * pointer-only ones (`clientX`, `pointerId`) are absent rather than faked.
	 * `pointerId` is -1, the same "no pointer" the context-menu path uses.
	 */
	function activationEvent(
		entry: Entry,
		native: Event,
		scene: Point = entry.placement.center,
	): ScenePointerEvent {
		const id = entry.record.id;
		const canonical = applyToPoint(options.canonicalView.peek(), scene);
		return {
			native: native as unknown as PointerEvent,
			pointerId: -1,
			canonical,
			scene,
			local: applyToPoint(entry.record.toLocal(), scene),
			camera: entry.placement.camera,
			id,
			pick: (exclude) =>
				options.driver?.()?.pick(canonical, exclude ?? id) ?? null,
			stopPropagation: () => {},
		};
	}

	/** Device (screen) directions → the node's own units, for one arrow key. */
	function localDirection(entry: Entry, screen: Point): Point {
		const deviceToLocal = compose(
			entry.record.toLocal(),
			invert(viewOf(entry.placement)),
		);
		return mapDirection(deviceToLocal, screen);
	}

	/** An event at item `item` of the entry's node, for keyboard hover and taps. */
	function itemEvent(
		entry: Entry,
		item: number,
		native: Event,
	): ScenePointerEvent {
		const spec = specIndex().get(entry.record.id);
		const at = (spec && itemCenter(spec, item)) ?? entry.placement.center;
		return { ...activationEvent(entry, native, at), item };
	}

	/**
	 * Moves the keyboard's current item: the item left is left and the one
	 * arrived at entered, exactly the events a pointer crossing between them
	 * sends, so a tooltip follows the keys with no code of its own.
	 */
	function moveItem(entry: Entry, item: number | null, native: Event): void {
		const handlers = entry.record.handlers();
		const before = current;
		const id = entry.record.id;
		if (before?.id === id && before.item === item) return;
		if (before && before.id === id) {
			handlers.onLeave?.(itemEvent(entry, before.item, native));
		}
		const next = item === null ? null : { id, item };
		current = next;
		options.onItem?.(next);
		if (item !== null) handlers.onEnter?.(itemEvent(entry, item, native));
		// The listbox's active descendant and option text follow at once, not at
		// the next frame: a screen reader reads them as the key lands.
		if (!reconciling && entries.get(id) === entry) renderEntry(entry);
	}

	/**
	 * Keys for a batched node's item list: the arrows, Home/End and PageUp/
	 * PageDown move the current item, Enter or Space taps it, Escape leaves it.
	 * True when the key was one of these.
	 */
	function onItemKey(
		entry: Entry,
		event: KeyboardEvent,
		seen: () => void,
	): boolean {
		const handlers = entry.record.handlers();
		const spec = specIndex().get(entry.record.id);
		if (!handlers.itemLabel || !spec || itemCount(spec) === 0) return false;
		const own = itemOf(entry.record.id);
		if (event.key === "Escape") {
			if (own === null) return false;
			event.preventDefault();
			moveItem(entry, null, event);
			return true;
		}
		if (event.key === "Enter" || event.key === " ") {
			if (own === null || !handlers.onTap) return false;
			event.preventDefault();
			seen();
			handlers.onTap(itemEvent(entry, own, event));
			return true;
		}
		const next = stepItem(spec, own, event.key, viewOf(entry.placement));
		if (next === null) return false;
		event.preventDefault();
		seen();
		moveItem(entry, next, event);
		return true;
	}

	function onKeyDown(entry: Entry, event: KeyboardEvent): void {
		const handlers = entry.record.handlers();
		// Acting on a node with a key makes its focus *visible*, even if a click
		// is what put the focus there. That is `:focus-visible`'s own rule: the
		// moment somebody starts using the keyboard they need to see where they
		// are, and until then a ring after every click is noise.
		const seen = () => focus.set(entry.record.id, "keyboard");

		/** The node's own key handler; true when it took the key. */
		const own = () => {
			if (!handlers.keyboard?.key?.(event)) return false;
			event.preventDefault();
			seen();
			return true;
		};

		if (event.key === "Escape") {
			// The driver already distinguishes a cancelled end, and a drag
			// restores its origin exactly on one, so this is a real undo rather
			// than a stop. It reaches only gestures that began on *this* node,
			// because the key arrived here: there is no global listener. Only an
			// Escape that cancelled nothing reaches the node's own handler (a
			// drill-down climbing out), so one press never both undoes a drag
			// and acts.
			if (options.driver?.()?.cancel(entry.record.id)) return;
			if (own()) return;
			onItemKey(entry, event, () => {});
			return;
		}

		if (own()) return;
		if (onItemKey(entry, event, seen)) return;

		if (event.key === "Enter" || event.key === " ") {
			const activate = handlers.keyboard?.activate;
			if (!activate && !handlers.onTap) return;
			// Space would otherwise scroll the page, and Enter would submit a form
			// the scene happens to sit in.
			event.preventDefault();
			seen();
			if (activate) activate.call(handlers.keyboard);
			else handlers.onTap?.(activationEvent(entry, event));
			return;
		}

		const arrow = ARROWS[event.key];
		const nudge = handlers.keyboard?.nudge;
		if (!arrow || !nudge) return;
		event.preventDefault();
		seen();
		nudge.call(handlers.keyboard, localDirection(entry, arrow), event.shiftKey);
	}

	// The first placement now, so the elements exist as soon as the mirror does;
	// later changes wait for a frame.
	update();

	return {
		element: overlay,
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const unsubscribe of unsubscribes) unsubscribe();
			reconciling = true;
			overlay.remove();
			entries.clear();
			reconciling = false;
		},
	};
}
