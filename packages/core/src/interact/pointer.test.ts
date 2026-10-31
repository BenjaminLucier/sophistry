import { describe, expect, it } from "vitest";
import { createPointerChannel } from "./pointer";

describe("pointer channel", () => {
	it("starts away and only wakes readers for a publish that says something new", () => {
		const channel = createPointerChannel();
		expect(channel.state.peek()).toBeNull();
		let stale = 0;
		channel.state.subscribe(() => stale++);
		const at = {
			canonical: { x: 1, y: 2 },
			scene: { x: 3, y: 4 },
			id: null,
			camera: -1,
		};
		channel.set(at);
		channel.set({ ...at, scene: { ...at.scene } });
		expect(stale).toBe(1);
		channel.set({ ...at, id: 5 });
		expect(stale).toBe(2);
		channel.set(null);
		channel.set(null);
		expect(stale).toBe(3);
	});
});
