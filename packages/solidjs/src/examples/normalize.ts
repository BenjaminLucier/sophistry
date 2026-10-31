/**
 * Spec frames as plain, comparable data, for the binding examples: the
 * Solid examples record them to `packages/react/src/examples/specs/*.json`
 * and the React examples must produce the same. A trimmed normaliser (neither binding depends on a shared one): ids
 * remapped in order of first appearance, lazy shape geometry resolved
 * (`plainShapeSpec`), typed arrays as arrays, numbers to 12 significant
 * digits, functions and `_`-prefixed caches dropped. The React binding keeps
 * an identical copy (`packages/react/src/examples/normalize.ts`).
 */

import type { Scene } from "@sophistry/core";
import type { ShapeSpec } from "@sophistry/core/internal";
import { plainShapeSpec } from "@sophistry/core/internal";

/** Records a scene's spec frames, ids numbered across the whole recording. */
export function createRecorder(scene: Scene): {
	/** Commits the scene and returns its current specs as plain data. */
	frame(): unknown;
} {
	const ids = new Map<number, number>();
	const id = (value: number) => {
		let mapped = ids.get(value);
		if (mapped === undefined) {
			mapped = ids.size + 1;
			ids.set(value, mapped);
		}
		return mapped;
	};
	const plain = (value: unknown, key: string): unknown => {
		if (typeof value === "number") {
			if (key === "id" || key.endsWith("Id")) return id(value);
			return Number.isFinite(value) ? Number(value.toPrecision(12)) : value;
		}
		if (value === null || typeof value !== "object") {
			return typeof value === "function" ? undefined : value;
		}
		if (ArrayBuffer.isView(value)) {
			return plain(Array.from(value as unknown as ArrayLike<number>), key);
		}
		if (Array.isArray(value)) {
			const idList = key.endsWith("Ids");
			return value.map((item) =>
				idList && typeof item === "number" ? id(item) : plain(item, ""),
			);
		}
		const source =
			(value as { kind?: unknown }).kind === "shape"
				? plainShapeSpec(value as ShapeSpec)
				: value;
		const out: Record<string, unknown> = {};
		for (const [entry, item] of Object.entries(source)) {
			if (entry.startsWith("_") || item === undefined) continue;
			const converted = plain(item, entry);
			if (converted !== undefined) out[entry] = converted;
		}
		return out;
	};
	return {
		frame() {
			scene.commit();
			return plain(scene.snapshot(), "");
		},
	};
}
