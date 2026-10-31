/**
 * Test plumbing for stages under happy-dom, which has no 2D context, no
 * layout and no real frames: `getContext` returns a do-nothing recorder,
 * every element measures at a fixed size, `requestAnimationFrame` queues
 * without running (tests call `scene.commit()`), and the observers are
 * stubs. The approach of core's `scene/test-dom.ts`, trimmed to what the
 * binding tests need. Not exported from any entry.
 */

/** Restores what {@link installDom} patched. */
export interface DomHarness {
	restore(): void;
}

/** A 2D context whose every method does nothing. */
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

/** Installs the stubs; call `restore()` after the test. */
export function installDom(width = 1000, height = 500): DomHarness {
	const globals = globalThis as Record<string, unknown>;
	const saved = {
		getContext: HTMLCanvasElement.prototype.getContext,
		rect: HTMLElement.prototype.getBoundingClientRect,
		raf: globals.requestAnimationFrame,
		caf: globals.cancelAnimationFrame,
		intersection: globals.IntersectionObserver,
		resize: globals.ResizeObserver,
	};
	const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
	HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
		let context = contexts.get(this);
		if (!context) {
			context = inertContext();
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
	globals.requestAnimationFrame = () => 0;
	globals.cancelAnimationFrame = () => {};
	const observer = class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	globals.IntersectionObserver = observer;
	globals.ResizeObserver = observer;
	return {
		restore() {
			HTMLCanvasElement.prototype.getContext = saved.getContext;
			HTMLElement.prototype.getBoundingClientRect = saved.rect;
			globals.requestAnimationFrame = saved.raf;
			globals.cancelAnimationFrame = saved.caf;
			globals.IntersectionObserver = saved.intersection;
			globals.ResizeObserver = saved.resize;
		},
	};
}
