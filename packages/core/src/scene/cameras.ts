/**
 * Cameras: several views of one scene in one canvas. A camera is a viewport
 * plus a framing over the single scene-unit snapshot, so a second camera
 * costs a second paint pass, not a second scene (see `render/camera.ts` for
 * the maths and `architecture.mdx`, "Stages and dirty bits", for why it is one
 * canvas with N viewports rather than a canvas per camera).
 *
 * A scene with no cameras paints one view filling the canvas under its own
 * framing; the renderer and the pointer driver treat an empty camera list
 * exactly like an omitted one. `scene.addCamera(...)` adds one; the layout
 * helpers ({@link splitScreen}, {@link pictureInPicture}, {@link quadView})
 * add two or four with their viewports arranged. Cameras paint in creation
 * order, later over earlier, each clipped to its viewport; `pickCamera`
 * resolves overlap the same way, so the camera painted on top is the one a
 * gesture lands in. A camera given an `anchor` node paints in its anchor's
 * tree order instead: that is how the bindings' `<Camera>` components paint
 * in JSX order.
 */

import type { ColorInput } from "../color";
import { cssColor } from "../color";
import type { Point } from "../geometry";
import type { Readable } from "../reactive";
import { isReadable } from "../reactive";
import type {
	CameraDefaults,
	CameraView,
	PipCorner,
	Viewport,
} from "../render/camera";
import {
	FULL_VIEWPORT,
	pictureInPictureViewports,
	quadViewports,
	splitViewports,
} from "../render/camera";
import type { BaseNode } from "./node";
import type { SceneNode } from "./types";

/**
 * Options for `scene.addCamera(...)`: the camera's props. Anything
 * omitted falls back to the scene's own framing and background, so
 * `scene.addCamera({ viewport })` alone is a plain window onto the scene as
 * it is already framed.
 *
 * @category Stage & cameras
 */
export interface CameraOptions {
	/**
	 * Scene units spanning this camera's viewport width. Lower is more zoomed
	 * in. A `Readable` binds, so a `track()` here animates a zoom. Defaults to
	 * the scene's `units`.
	 */
	units?: number | Readable<number>;
	/**
	 * The scene point at the middle of this camera's viewport, in scene units.
	 * A `Readable` binds, so a camera bound to a moving point follows it.
	 * Defaults to the scene's `center`.
	 */
	center?: Point | Readable<Point>;
	/** Whether `y` increases upward in this view. Defaults to the scene's `yUp`. */
	yUp?: boolean;
	/**
	 * Where on the canvas it paints, as fractions of the canvas (0..1) with
	 * the origin at the top-left. `{ x: 0.5, y: 0, width: 0.5, height: 1 }` is
	 * the right-hand half. Later cameras paint over earlier ones. Defaults to
	 * the whole canvas.
	 */
	viewport?: Viewport;
	/**
	 * Border colour (a CSS string or a `Color`), drawn as chrome just inside
	 * the viewport edge. No border when omitted or `null`. A `Readable` binds
	 * (a border following the theme's accent).
	 */
	border?: ColorInput | null | Readable<ColorInput | null>;
	/**
	 * Border width in CSS pixels. Does not scale with zoom.
	 *
	 * @default 2
	 */
	borderWidth?: number;
	/**
	 * Fill painted before the scene: a CSS string or a `Color`. Defaults to
	 * the scene's background (the theme's, unless the scene sets
	 * `background`), which is what makes overlapping viewports (a
	 * picture-in-picture inset) opaque. `null` leaves whatever is underneath
	 * showing through. A `Readable` binds.
	 */
	background?: ColorInput | null | Readable<ColorInput | null>;
	/**
	 * A node of the scene whose place in the tree sets this camera's paint
	 * order: cameras with an anchor paint in their anchors' depth-first tree
	 * order, re-sorted whenever the tree's structure changes, all under the
	 * cameras without one (which paint in creation order). An anchor that is
	 * not in the scene counts as none. The bindings' `<Camera>` passes an
	 * empty node it places where the component sits, so cameras paint in JSX
	 * order.
	 */
	anchor?: SceneNode | null;
}

/**
 * One view of the scene, made by `scene.addCamera(...)`.
 *
 * @category Stage & cameras
 */
export interface Camera {
	/** What this camera paints, resolved against the scene's framing. */
	readonly view: Readable<CameraView>;
	/** Whether {@link Camera.dispose} has run. */
	readonly disposed: boolean;
	/**
	 * Changes some options. A key given as `undefined` goes back to its
	 * default (the scene's framing, the whole canvas, no border).
	 */
	update(options: CameraOptions): void;
	/** Removes the camera. With none left the scene paints its own single view. Idempotent. */
	dispose(): void;
}

/**
 * The scene's cameras, in paint order, and their resolved views.
 *
 * @internal
 */
export interface CameraList {
	/**
	 * The resolved views, in paint (creation) order. The array keeps its
	 * identity while no view changed, and each view keeps its identity while
	 * it resolves to the same thing, so the renderer's identity check skips a
	 * camera that re-published an equal view.
	 */
	readonly views: Readable<readonly CameraView[]>;
	/** Adds a camera after the existing ones. */
	add(options?: CameraOptions): Camera;
	/** Removes every camera and stops listening to the defaults. */
	dispose(): void;
}

/** One camera's options and the bindings it holds. */
interface CameraEntry {
	options: CameraOptions;
	/** Unsubscribes from the camera's bound `units`/`center`/`border`/`background`. */
	unbind: (() => void)[];
	/** The view resolved last, kept while an equal one comes out. */
	last: CameraView | null;
}

const NO_VIEWS: readonly CameraView[] = Object.freeze([]);

/** Whether two resolved views would paint identically. */
function sameView(a: CameraView, b: CameraView): boolean {
	return (
		a.units === b.units &&
		a.center.x === b.center.x &&
		a.center.y === b.center.y &&
		a.yUp === b.yUp &&
		a.viewport.x === b.viewport.x &&
		a.viewport.y === b.viewport.y &&
		a.viewport.width === b.viewport.width &&
		a.viewport.height === b.viewport.height &&
		a.border === b.border &&
		a.borderWidth === b.borderWidth &&
		a.background === b.background
	);
}

/** A bindable option's current value. */
function read<T>(value: T | Readable<T> | undefined): T | undefined {
	return isReadable(value) ? (value.peek() as T) : value;
}

/** A camera's options resolved against the scene's framing. */
function resolveView(
	options: CameraOptions,
	defaults: CameraDefaults,
): CameraView {
	const border = read(options.border);
	const background = read(options.background);
	return {
		units: read(options.units) ?? defaults.units,
		center: read(options.center) ?? defaults.center,
		yUp: options.yUp ?? defaults.yUp,
		viewport: options.viewport ?? FULL_VIEWPORT,
		border: border === undefined || border === null ? null : cssColor(border),
		borderWidth: options.borderWidth ?? 2,
		// The scene resolves its background to a CSS colour (the theme's for
		// `"theme"`) or null for a transparent scene, which its cameras follow.
		background:
			background === undefined
				? (defaults.background ?? null)
				: background === null
					? null
					: cssColor(background),
	};
}

/**
 * Creates the camera list of one scene.
 *
 * Cameras are kept in creation order, which is the whole paint order: the
 * camera painted last is the one on top, and `pickCamera` resolves overlap
 * the same way. Views are resolved lazily, on `views.peek()`, after any bound
 * input or the scene's framing went stale.
 *
 * @param defaults - The scene's framing and background, which a camera falls
 * back to for anything it omits.
 * @param onStructureChange - Subscribes to the scene graph's structure
 * changes (`SceneGraph.onStructureChange`); called lazily, when the first
 * camera with an `anchor` arrives, to re-sort anchored cameras.
 * @returns The list; the scene's `addCamera` calls `add`, and the renderer and
 * the pointer driver read `views`.
 *
 * @internal
 */
export function createCameraList(
	defaults: Readable<CameraDefaults>,
	onStructureChange?: (listener: () => void) => () => void,
): CameraList {
	const entries: CameraEntry[] = [];
	/** Unsubscribes from structure changes, once an anchored camera subscribed. */
	let stopStructure: (() => void) | null = null;
	const subscribers = new Set<() => void>();
	let cached: readonly CameraView[] = NO_VIEWS;
	let stale = false;
	let disposed = false;

	const markStale = () => {
		stale = true;
		for (const onStale of [...subscribers]) onStale();
	};
	const stopDefaults = defaults.subscribe(markStale);

	const resolve = (): readonly CameraView[] => {
		if (!stale) return cached;
		stale = false;
		if (entries.length === 0) {
			cached = NO_VIEWS;
			return cached;
		}
		const framing = defaults.peek();
		let changed = entries.length !== cached.length;
		const next = paintOrder(entries).map((entry, index) => {
			const view = resolveView(entry.options, framing);
			const kept = entry.last && sameView(entry.last, view) ? entry.last : view;
			entry.last = kept;
			if (kept !== cached[index]) changed = true;
			return kept;
		});
		if (changed) cached = Object.freeze(next);
		return cached;
	};

	const views: Readable<readonly CameraView[]> = {
		peek: resolve,
		subscribe(onStale) {
			subscribers.add(onStale);
			return () => {
				subscribers.delete(onStale);
			};
		},
	};

	/** Subscribes to the entry's bound inputs, replacing earlier bindings. */
	const bind = (entry: CameraEntry) => {
		for (const stop of entry.unbind) stop();
		entry.unbind = [];
		if (entry.options.anchor && !stopStructure && onStructureChange) {
			stopStructure = onStructureChange(markStale);
		}
		const { units, center, border, background } = entry.options;
		for (const value of [units, center, border, background]) {
			if (isReadable(value)) entry.unbind.push(value.subscribe(markStale));
		}
	};

	return {
		views,
		add(options = {}) {
			if (disposed)
				throw new Error("addCamera(): the scene has been disposed.");
			const entry: CameraEntry = {
				options: { ...options },
				unbind: [],
				last: null,
			};
			entries.push(entry);
			bind(entry);
			markStale();
			let removed = false;
			const camera: Camera = {
				view: {
					peek() {
						resolve();
						return entry.last ?? resolveView(entry.options, defaults.peek());
					},
					subscribe: views.subscribe,
				},
				get disposed() {
					return removed;
				},
				update(changes) {
					if (removed) return;
					entry.options = { ...entry.options, ...changes };
					bind(entry);
					markStale();
				},
				dispose() {
					if (removed) return;
					removed = true;
					for (const stop of entry.unbind) stop();
					entry.unbind = [];
					const at = entries.indexOf(entry);
					if (at >= 0) entries.splice(at, 1);
					markStale();
				},
			};
			return camera;
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			stopDefaults();
			stopStructure?.();
			stopStructure = null;
			for (const entry of entries) {
				for (const stop of entry.unbind) stop();
			}
			entries.length = 0;
			cached = NO_VIEWS;
			stale = false;
			subscribers.clear();
		},
	};
}

/** The tree index of an entry's anchor, or null without one in a scene. */
function anchorIndex(entry: CameraEntry): number | null {
	const anchor = entry.options.anchor as BaseNode | null | undefined;
	if (!anchor || anchor.disposed || anchor.graph === null) return null;
	return anchor.treeIndex < 0 ? null : anchor.treeIndex;
}

/**
 * The entries in paint order: anchored ones by their anchors' tree order,
 * then the rest in creation order. Returns `entries` itself when no camera
 * is anchored (the common case allocates nothing extra).
 */
function paintOrder(entries: readonly CameraEntry[]): readonly CameraEntry[] {
	const anchored: [number, CameraEntry][] = [];
	const free: CameraEntry[] = [];
	for (const entry of entries) {
		const index = anchorIndex(entry);
		if (index === null) free.push(entry);
		else anchored.push([index, entry]);
	}
	if (anchored.length === 0) return entries;
	anchored.sort((a, b) => a[0] - b[0]);
	return [...anchored.map(([, entry]) => entry), ...free];
}

/* ------------------------------------------------------------- layouts */

/**
 * What the layout helpers need from a scene: somewhere to add cameras.
 *
 * @category Stage & cameras
 */
export interface CameraHost {
	addCamera(options?: CameraOptions): Camera;
}

/**
 * A {@link CameraOptions} minus its `viewport`: what the layout helpers
 * ({@link splitScreen}, {@link pictureInPicture}, {@link quadView}) arrange.
 *
 * @category Stage & cameras
 */
export type CameraPane = Omit<CameraOptions, "viewport">;

/**
 * Cameras added together by a layout helper.
 *
 * @typeParam C - The cameras, as a tuple in paint order.
 * @typeParam L - The layout options `update` takes.
 *
 * @category Stage & cameras
 */
export interface CameraLayout<C extends readonly Camera[], L> {
	/** The cameras, in paint order. Update a pane through its camera. */
	readonly cameras: C;
	/** Changes the arrangement (not the panes); omitted keys keep their value. */
	update(layout: L): void;
	/** Removes every camera of the layout. */
	dispose(): void;
}

/**
 * Layout options of {@link splitScreen}.
 *
 * @category Stage & cameras
 */
export interface SplitScreenLayout {
	/**
	 * `"horizontal"` puts the panes left and right (the divider is vertical),
	 * `"vertical"` puts them top and bottom. The name is manim-web's.
	 *
	 * @default "horizontal"
	 */
	split?: "horizontal" | "vertical";
	/**
	 * The first pane's share of the canvas, 0..1 (clamped).
	 *
	 * @default 0.5
	 */
	ratio?: number;
}

/**
 * Two cameras sharing the canvas, side by side or stacked: manim-web's
 * `SplitScreenCamera`.
 *
 * @example
 * ```ts
 * import { createScene, splitScreen } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body, units: 10 });
 * const split = splitScreen(scene, { panes: [{}, { units: 4, center: { x: 2, y: 0 } }] });
 * split.update({ ratio: 0.6 });
 * ```
 *
 * @param scene - The scene to add the cameras to.
 * @param options - `panes`: the two cameras, first pane (left or top) first,
 * each a {@link CameraPane}; plus the {@link SplitScreenLayout}.
 * @returns The cameras and a handle to rearrange or remove them.
 *
 * @category Stage & cameras
 */
export function splitScreen(
	scene: CameraHost,
	options: { panes: [CameraPane, CameraPane] } & SplitScreenLayout,
): CameraLayout<[Camera, Camera], SplitScreenLayout> {
	let layout: Required<SplitScreenLayout> = {
		split: options.split ?? "horizontal",
		ratio: options.ratio ?? 0.5,
	};
	const viewports = () => splitViewports(layout.split, layout.ratio);
	const [first, second] = viewports();
	const cameras: [Camera, Camera] = [
		scene.addCamera({ ...options.panes[0], viewport: first }),
		scene.addCamera({ ...options.panes[1], viewport: second }),
	];
	return arrange(cameras, (next: SplitScreenLayout) => {
		layout = { ...layout, ...defined(next) };
		return viewports();
	});
}

/**
 * Layout options of {@link pictureInPicture}.
 *
 * @category Stage & cameras
 */
export interface PictureInPictureLayout {
	/**
	 * Which corner holds the inset.
	 *
	 * @default "top-right"
	 */
	corner?: PipCorner;
	/**
	 * The inset's share of each canvas dimension, 0..1.
	 *
	 * @default 0.3
	 */
	size?: number;
	/**
	 * Gap between the inset and the canvas edges, as a fraction of each
	 * canvas dimension.
	 *
	 * @default 0.02
	 */
	margin?: number;
}

/**
 * A full-canvas view with a magnified inset pinned to a corner: manim-web's
 * `setupPictureInPicture`. Give the inset a smaller `units` and a `center`
 * bound to something that moves, and it becomes a moving magnifier.
 *
 * The inset paints after (over) the main view and has an opaque background
 * by default; pointer gestures that start inside it belong to the inset.
 *
 * @example
 * ```ts
 * import { createScene, pictureInPicture, trackPoint } from "@sophistry/core";
 *
 * const dot = trackPoint(2, 0);
 * const scene = createScene({ host: document.body, units: 10 });
 * pictureInPicture(scene, { main: {}, inset: { units: 4, center: dot }, corner: "bottom-left" });
 * ```
 *
 * @param scene - The scene to add the cameras to.
 * @param options - `main` (the full-canvas camera) and `inset` (the corner
 * camera), each a {@link CameraPane}; plus the {@link PictureInPictureLayout}.
 * @returns The cameras (`[main, inset]`) and a handle to rearrange or remove them.
 *
 * @category Stage & cameras
 */
export function pictureInPicture(
	scene: CameraHost,
	options: { main: CameraPane; inset: CameraPane } & PictureInPictureLayout,
): CameraLayout<[Camera, Camera], PictureInPictureLayout> {
	let layout: Required<PictureInPictureLayout> = {
		corner: options.corner ?? "top-right",
		size: options.size ?? 0.3,
		margin: options.margin ?? 0.02,
	};
	const viewports = () =>
		pictureInPictureViewports(layout.corner, layout.size, layout.margin);
	const [main, inset] = viewports();
	const cameras: [Camera, Camera] = [
		scene.addCamera({ ...options.main, viewport: main }),
		scene.addCamera({ ...options.inset, viewport: inset }),
	];
	return arrange(cameras, (next: PictureInPictureLayout) => {
		layout = { ...layout, ...defined(next) };
		return viewports();
	});
}

/**
 * Four panes in a 2×2 grid, in reading order: manim-web's `setupQuadView`.
 * Conventionally the first is the overview and the rest are close-ups, but
 * the grid does not enforce that.
 *
 * @param scene - The scene to add the cameras to.
 * @param options - `panes`: four {@link CameraPane}s in reading order
 * (top-left, top-right, bottom-left, bottom-right).
 * @returns The cameras and a handle to remove them (the grid has no layout
 * options, so `update` does nothing).
 *
 * @category Stage & cameras
 */
export function quadView(
	scene: CameraHost,
	options: { panes: [CameraPane, CameraPane, CameraPane, CameraPane] },
): CameraLayout<[Camera, Camera, Camera, Camera], Record<string, never>> {
	const viewports = quadViewports();
	const cameras: [Camera, Camera, Camera, Camera] = [
		scene.addCamera({ ...options.panes[0], viewport: viewports[0] }),
		scene.addCamera({ ...options.panes[1], viewport: viewports[1] }),
		scene.addCamera({ ...options.panes[2], viewport: viewports[2] }),
		scene.addCamera({ ...options.panes[3], viewport: viewports[3] }),
	];
	return arrange(cameras, () => viewports);
}

/** The keys of `value` that are not `undefined`. */
function defined<T extends object>(value: T): Partial<T> {
	const out: Partial<T> = {};
	for (const key of Object.keys(value) as (keyof T)[]) {
		if (value[key] !== undefined) out[key] = value[key];
	}
	return out;
}

/** A layout handle over `cameras`, re-laid out by `layoutFor`. */
function arrange<C extends readonly Camera[], L>(
	cameras: C,
	layoutFor: (layout: L) => readonly Viewport[],
): CameraLayout<C, L> {
	return {
		cameras,
		update(layout) {
			const viewports = layoutFor(layout);
			cameras.forEach((camera, index) => {
				camera.update({ viewport: viewports[index] });
			});
		},
		dispose() {
			for (const camera of cameras) camera.dispose();
		},
	};
}
