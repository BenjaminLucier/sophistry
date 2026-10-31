/**
 * Test plumbing for scenes under happy-dom, which has no 2D context, no
 * layout and no real frames: `getContext` returns a recorder, every element
 * measures at a fixed size, `requestAnimationFrame` is a manual queue, and
 * `IntersectionObserver`/`ResizeObserver` are stubs whose callbacks the
 * tests invoke.
 * A copy of core's `scene/test-dom.ts` (not exported from any core entry),
 * for the multiview stage tests. Not exported from the package.
 */

import { resetFrameLoop } from "@sophistry/core/internal";

/** One recorded canvas call: a method (`op`) or a property write (`set:name`). */
export interface Call {
	op: string;
	args: unknown[];
}

/** A stubbed observer the test can drive. */
export interface ObserverStub {
	callback: (entries: unknown[]) => void;
	targets: Element[];
	disconnected: boolean;
}

/** The installed stubs, and how to drive and remove them. */
export interface DomHarness {
	/** Every call made on any canvas context since the last {@link DomHarness.takeCalls}. */
	readonly calls: Call[];
	/** Returns the recorded calls and starts a new record. */
	takeCalls(): Call[];
	/** The queued `requestAnimationFrame` callbacks. */
	readonly queue: FrameRequestCallback[];
	/** Runs the callbacks queued so far as one browser frame at `now` ms. */
	runFrame(now: number): void;
	/** Runs frames while any are queued (up to `limit`), from `now` in 16 ms steps. Returns how many ran. */
	drain(now?: number, limit?: number): number;
	/** The `IntersectionObserver`s created, in order (empty when unsupported). */
	readonly intersections: ObserverStub[];
	/** The `ResizeObserver`s created, in order. */
	readonly resizes: ObserverStub[];
	/** Reports `isIntersecting` to the `index`th intersection observer. */
	reportVisible(index: number, isIntersecting: boolean): void;
	/** Changes what every element measures. */
	setRect(width: number, height: number): void;
	/** Restores every patched global and prototype. */
	restore(): void;
}

/** A recording 2D context: methods log a call, property writes log `set:name`. */
function recorder(calls: Call[]): CanvasRenderingContext2D {
	const target: Record<string, unknown> = {};
	return new Proxy(target, {
		get(_, prop: string) {
			if (prop === "measureText") return () => ({ width: 10 });
			if (prop in target) return target[prop];
			return (...args: unknown[]) => {
				calls.push({ op: prop, args });
			};
		},
		set(_, prop: string, value: unknown) {
			target[prop] = value;
			calls.push({ op: `set:${prop}`, args: [value] });
			return true;
		},
	}) as unknown as CanvasRenderingContext2D;
}

/**
 * Installs the stubs. `options.intersection: false` leaves
 * `IntersectionObserver` undefined, as in an environment without it.
 */
export function installDom(
	options: { width?: number; height?: number; intersection?: boolean } = {},
): DomHarness {
	resetFrameLoop();
	const calls: Call[] = [];
	const queue: FrameRequestCallback[] = [];
	const intersections: ObserverStub[] = [];
	const resizes: ObserverStub[] = [];
	let width = options.width ?? 1000;
	let height = options.height ?? 500;

	const globals = globalThis as Record<string, unknown>;
	const saved = {
		getContext: HTMLCanvasElement.prototype.getContext,
		rect: HTMLElement.prototype.getBoundingClientRect,
		raf: globals.requestAnimationFrame,
		caf: globals.cancelAnimationFrame,
		intersection: globals.IntersectionObserver,
		resize: globals.ResizeObserver,
		matchMedia: window.matchMedia,
		dpr: window.devicePixelRatio,
	};

	// One context per canvas, all recording into the shared log.
	const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
	HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
		let context = contexts.get(this);
		if (!context) {
			context = recorder(calls);
			contexts.set(this, context);
		}
		return context;
	} as unknown as typeof HTMLCanvasElement.prototype.getContext;
	HTMLElement.prototype.getBoundingClientRect = () =>
		({
			left: 0,
			top: 0,
			right: width,
			bottom: height,
			x: 0,
			y: 0,
			width,
			height,
		}) as DOMRect;
	globals.requestAnimationFrame = (callback: FrameRequestCallback) => {
		queue.push(callback);
		return queue.length;
	};
	globals.cancelAnimationFrame = () => {};
	window.devicePixelRatio = 1;

	const observerClass = (list: ObserverStub[]) =>
		class {
			stub: ObserverStub;
			constructor(callback: (entries: unknown[]) => void) {
				this.stub = { callback, targets: [], disconnected: false };
				list.push(this.stub);
			}
			observe(target: Element) {
				this.stub.targets.push(target);
			}
			unobserve() {}
			disconnect() {
				this.stub.disconnected = true;
			}
		};
	globals.IntersectionObserver =
		options.intersection === false ? undefined : observerClass(intersections);
	globals.ResizeObserver = observerClass(resizes);

	const runFrame = (now: number) => {
		const callbacks = queue.splice(0);
		for (const callback of callbacks) callback(now);
	};

	return {
		get calls() {
			return calls;
		},
		takeCalls() {
			// The recorders push into the array they were made with, so it is
			// emptied in place rather than replaced.
			const copy = calls.slice();
			calls.length = 0;
			return copy;
		},
		queue,
		runFrame,
		drain(now = 1000, limit = 20) {
			let ran = 0;
			while (queue.length > 0 && ran < limit) {
				runFrame(now + ran * 16);
				ran++;
			}
			return ran;
		},
		intersections,
		resizes,
		reportVisible(index, isIntersecting) {
			intersections[index]?.callback([{ isIntersecting }]);
		},
		setRect(nextWidth, nextHeight) {
			width = nextWidth;
			height = nextHeight;
		},
		restore() {
			HTMLCanvasElement.prototype.getContext = saved.getContext;
			HTMLElement.prototype.getBoundingClientRect = saved.rect;
			globals.requestAnimationFrame = saved.raf;
			globals.cancelAnimationFrame = saved.caf;
			globals.IntersectionObserver = saved.intersection;
			globals.ResizeObserver = saved.resize;
			window.matchMedia = saved.matchMedia;
			window.devicePixelRatio = saved.dpr;
			resetFrameLoop();
			document.body.innerHTML = "";
		},
	};
}

/**
 * The x of each shape's first vertex in scene units, in painted order: a
 * stand-in for "which shape". A shape drawn in its own units under a
 * `ctx.transform` (set back to the view after) goes through the last one in
 * force.
 */
export function paintedXs(calls: readonly Call[]): number[] {
	const xs: number[] = [];
	let local: number[] | null = null;
	for (const call of calls) {
		if (call.op === "setTransform") local = null;
		else if (call.op === "transform") local = call.args as number[];
		else if (call.op === "moveTo") {
			const [x, y] = call.args as number[];
			xs.push(
				local ? (local[0] ?? 1) * x + (local[2] ?? 0) * y + (local[4] ?? 0) : x,
			);
		}
	}
	return xs;
}

/** A fresh element appended to the body, to mount a scene into. */
export function mountPoint(): HTMLElement {
	const host = document.createElement("div");
	document.body.append(host);
	return host;
}
