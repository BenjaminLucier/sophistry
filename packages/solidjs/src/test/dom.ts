/**
 * Test plumbing for stages under happy-dom, which has no 2D context, no
 * layout and no real frames: `getContext` returns a no-op recorder, every
 * element measures at a fixed size, `requestAnimationFrame` is a manual queue
 * and the observers are inert stubs. The approach of core's
 * `scene/test-dom.ts`, trimmed to what these tests need. Test-only: no entry
 * exports it.
 */

import { resetFrameLoop } from "@sophistry/core/internal";

/** The installed stubs and how to remove them. */
export interface DomHarness {
	/** The queued `requestAnimationFrame` callbacks. */
	readonly queue: FrameRequestCallback[];
	/** Restores every patched global and prototype and empties the body. */
	restore(): void;
}

/** A context whose methods do nothing and whose `measureText` is fixed. */
function inertContext(): CanvasRenderingContext2D {
	const target: Record<string, unknown> = {};
	return new Proxy(target, {
		get(_, prop: string) {
			if (prop === "measureText") return () => ({ width: 10 });
			if (prop in target) return target[prop];
			return () => {};
		},
		set(_, prop: string, value: unknown) {
			target[prop] = value;
			return true;
		},
	}) as unknown as CanvasRenderingContext2D;
}

/** Installs the stubs; call `restore()` after each test. */
export function installDom(): DomHarness {
	resetFrameLoop();
	const queue: FrameRequestCallback[] = [];
	const globals = globalThis as Record<string, unknown>;
	const saved = {
		getContext: HTMLCanvasElement.prototype.getContext,
		rect: HTMLElement.prototype.getBoundingClientRect,
		raf: globals.requestAnimationFrame,
		caf: globals.cancelAnimationFrame,
		intersection: globals.IntersectionObserver,
		resize: globals.ResizeObserver,
	};
	HTMLCanvasElement.prototype.getContext = (() =>
		inertContext()) as unknown as typeof HTMLCanvasElement.prototype.getContext;
	HTMLElement.prototype.getBoundingClientRect = () =>
		({
			left: 0,
			top: 0,
			right: 1000,
			bottom: 500,
			x: 0,
			y: 0,
			width: 1000,
			height: 500,
		}) as DOMRect;
	globals.requestAnimationFrame = (callback: FrameRequestCallback) => {
		queue.push(callback);
		return queue.length;
	};
	globals.cancelAnimationFrame = () => {};
	const inertObserver = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	globals.IntersectionObserver = inertObserver;
	globals.ResizeObserver = inertObserver;
	return {
		queue,
		restore() {
			HTMLCanvasElement.prototype.getContext = saved.getContext;
			HTMLElement.prototype.getBoundingClientRect = saved.rect;
			globals.requestAnimationFrame = saved.raf;
			globals.cancelAnimationFrame = saved.caf;
			globals.IntersectionObserver = saved.intersection;
			globals.ResizeObserver = saved.resize;
			resetFrameLoop();
			document.body.innerHTML = "";
		},
	};
}

/** A fresh element appended to the body, to render into. */
export function mountPoint(): HTMLElement {
	const host = document.createElement("div");
	document.body.append(host);
	return host;
}
