/**
 * Test plumbing: a stand-in for the shared frame loop's paint phase, wired to
 * a renderer exactly as the scene wires the real one (`onPaintRequest` asks
 * for a frame; a frame paints when `needsPaint()`). A request made while a
 * frame runs lands in the next frame, as `requestFrame()` does.
 *
 * Not exported from any entry; only the render tests import it.
 */

import type { Renderer, RendererOptions } from "./canvas-renderer";
import { createCanvasRenderer } from "./canvas-renderer";

/** A renderer plus the frames its paint requests have queued. */
export interface PaintHost {
	renderer: Renderer;
	/** Whether a frame has been requested and not yet run. */
	requested(): boolean;
	/** Runs one frame: paints if the renderer wants it. Returns whether it painted. */
	frame(): boolean;
	/** Runs frames while one is requested, up to `limit`. Returns how many ran. */
	drain(limit?: number): number;
}

/**
 * Creates a renderer driven by a fake paint loop. `setup` runs before the
 * first drain, so the initial state lands in one first paint.
 */
export function createPaintHost(
	options: Omit<RendererOptions, "onPaintRequest">,
	setup?: (renderer: Renderer) => void,
): PaintHost {
	// Starts requested: a new renderer is dirty and wants its first paint.
	let requested = true;
	const renderer = createCanvasRenderer({
		...options,
		onPaintRequest: () => {
			requested = true;
		},
	});
	const frame = () => {
		requested = false;
		if (!renderer.needsPaint()) return false;
		renderer.paint();
		return true;
	};
	setup?.(renderer);
	return {
		renderer,
		requested: () => requested,
		frame,
		drain(limit = 10) {
			let ran = 0;
			while (requested && ran < limit) {
				frame();
				ran += 1;
			}
			return ran;
		},
	};
}
