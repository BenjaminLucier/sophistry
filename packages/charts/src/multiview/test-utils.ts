/**
 * Test helpers for the multiview family: synthetic pointer, wheel and key
 * events as the pointer driver and the accessibility mirror hand them to a
 * node's behaviours, and a headless scene whose interaction registry the
 * tests read. Not exported from the package.
 */

import type {
	SceneNode,
	SceneNodeWheelEvent,
	ScenePointerEvent,
} from "@sophistry/core";
import { createScene } from "@sophistry/core";
import type {
	InteractionRecord,
	MarksSpec,
	ShapeSpec,
	TextSpec,
} from "@sophistry/core/internal";
import { sceneInternals } from "@sophistry/core/internal";
import { theme } from "../test-harness.js";

/** A pointer event at plot point (x, y); 100 CSS px per scene unit. */
export const at = (x: number, y = 0, pointerId = 1, shiftKey = false) =>
	({
		native: { clientX: x * 100, clientY: -y * 100, target: null, shiftKey },
		pointerId,
		canonical: { x, y },
		scene: { x, y },
		local: { x, y },
		camera: -1,
		id: 1,
		pick: () => null,
		stopPropagation: () => {},
	}) as unknown as ScenePointerEvent;

/** A wheel at plot point (x, y), as the driver hands it to `onWheel`. */
export const wheelAt = (
	x: number,
	y: number,
	deltaY: number,
	ctrlKey = false,
) =>
	({
		native: { deltaX: 0, deltaY, deltaMode: 0, ctrlKey },
		canonical: { x, y },
		scene: { x, y },
		local: { x, y },
		camera: -1,
		id: 1,
		unitsPerPixel: { x: 0.01, y: -0.01 },
	}) as unknown as SceneNodeWheelEvent;

/** A key press as the accessibility layer hands it to `keyboard.key`. */
export const press = (key: string) =>
	({ key, preventDefault: () => {} }) as unknown as KeyboardEvent;

/** Track values rounded to 1e-9 (and -0 made 0). */
export const values = (pair: readonly { peek(): number }[]) =>
	pair.map((cell) => Math.round(cell.peek() * 1e9) / 1e9 + 0);

/**
 * A headless scene with `nodes` added and committed, plus readers over its
 * frame and its interaction registry.
 */
export function stage(...nodes: SceneNode[]) {
	const scene = createScene({ headless: true, theme });
	for (const node of nodes) scene.add(node);
	scene.commit();
	const registry = sceneInternals(scene)?.registry;
	if (!registry) throw new Error("no registry");
	const specs = () =>
		scene.snapshot() as readonly (ShapeSpec | TextSpec | MarksSpec)[];
	const find = (label: string): InteractionRecord => {
		scene.commit();
		const record = registry.records().find((r) => r.label() === label);
		if (!record) throw new Error(`no node labelled ${label}`);
		return record;
	};
	return {
		scene,
		registry,
		commit: () => scene.commit(),
		find,
		specs,
		shapes: () => specs().filter((s): s is ShapeSpec => s.kind === "shape"),
		texts: () => specs().filter((s): s is TextSpec => s.kind === "text"),
		focusable: () => {
			scene.commit();
			return registry.focusable().map((r) => r.label());
		},
	};
}

/** A shape spec's box over its polylines. */
export function boxOf(shape: ShapeSpec) {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const line of shape.polylines) {
		for (const p of line as readonly { x: number; y: number }[]) {
			minX = Math.min(minX, p.x);
			minY = Math.min(minY, p.y);
			maxX = Math.max(maxX, p.x);
			maxY = Math.max(maxY, p.y);
		}
	}
	return { minX, minY, maxX, maxY };
}
