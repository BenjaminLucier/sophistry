import { afterEach, expect, it } from "vitest";
import { captureMode, publishCapture } from "./capture";

afterEach(() => {
	window.history.replaceState(null, "", "/");
	delete window.__sophistryCapture;
});

it("is on only with ?capture in the URL", () => {
	expect(captureMode()).toBe(false);
	window.history.replaceState(null, "", "/gallery/basic/?capture");
	expect(captureMode()).toBe(true);
});

it("steps the clock by a fixed amount until nothing is running", async () => {
	const steps: number[] = [];
	let running = 1;
	publishCapture(
		"basic/Example",
		(dt) => {
			steps.push(dt);
			if (steps.length === 45) running = 0;
		},
		() => running,
	);
	const result = await window.__sophistryCapture?.["basic/Example"]?.settle(60);
	expect(result?.idle).toBe(true);
	expect(result?.time).toBeCloseTo(45 / 60, 9);
	expect(steps).toHaveLength(45);
	expect(new Set(steps)).toEqual(new Set([1 / 60]));
});

it("lets the run started by a resolved step begin before the next step", async () => {
	// A script awaiting `play(a)` starts `play(b)` in a promise reaction; the
	// step after must already see it.
	let running = 1;
	let seen = 0;
	publishCapture(
		"basic/Chain",
		() => {
			seen++;
			if (seen === 1) {
				running = 0;
				void Promise.resolve()
					.then(() => undefined)
					.then(() => {
						running = 1;
					});
			} else if (seen === 3) running = 0;
		},
		() => running,
	);
	const result = await window.__sophistryCapture?.["basic/Chain"]?.settle(60);
	expect(seen).toBe(3);
	expect(result?.idle).toBe(true);
});

it("stops at the limit for an example that never rests", async () => {
	let steps = 0;
	publishCapture(
		"basic/Loop",
		() => {
			steps++;
		},
		() => 1,
	);
	const result = await window.__sophistryCapture?.["basic/Loop"]?.settle(2.5);
	expect(steps).toBe(150);
	expect(result?.idle).toBe(false);
	expect(result?.time).toBeCloseTo(2.5, 9);
});

it("withdraws its handle", () => {
	const withdraw = publishCapture(
		"basic/Gone",
		() => {},
		() => 0,
	);
	expect(window.__sophistryCapture?.["basic/Gone"]).toBeDefined();
	withdraw();
	expect(window.__sophistryCapture?.["basic/Gone"]).toBeUndefined();
});
