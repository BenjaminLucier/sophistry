import { describe, expect, it } from "vitest";
import { pointerContext } from "./context.js";
import { group } from "./group.js";
import { createScene } from "./scene.js";

describe("pointerContext", () => {
	it("is null outside a scene", () => {
		expect(pointerContext.defaultValue ?? null).toBeNull();
	});

	it("is the scene's pointer inside one", () => {
		const scene = createScene({ headless: true, units: 16 });
		try {
			const child = scene.add(group.create({}));
			const provided = child.context(pointerContext);
			expect(provided).not.toBeNull();
			expect(provided?.peek()).toBe(scene.pointer.peek());
		} finally {
			scene.dispose();
		}
	});
});
