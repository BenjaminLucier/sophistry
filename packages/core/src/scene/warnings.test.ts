// @vitest-environment happy-dom
/**
 * A representative scene, mounted, reframed and animated through the real
 * frame loop, logs nothing to the console, and a scene with cameras never
 * paints a frame that mixes new and stale state.
 *
 * What is guarded is a silent console and a consistent picture. The tear to
 * watch for is a renderer seeing a camera's new framing and a node's old
 * spec in one paint: here every paint of a picture-in-picture inset
 * bound to a moving node must show the node exactly at the inset's centre.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { moveTo } from "../anim/move.js";
import { sequence } from "../anim/sequence.js";
import { track } from "../reactive/index.js";
import { circle } from "../shapes/circle.js";
import { rect } from "../shapes/rect.js";
import { createClock } from "../tween/clock.js";
import { trackPoint } from "../tween/track.js";
import { pictureInPicture, splitScreen } from "./cameras.js";
import { group } from "./group.js";
import type { Scene, SceneOptions } from "./scene.js";
import { createScene } from "./scene.js";
import type { Call, DomHarness } from "./test-dom.js";
import { installDom, mountPoint } from "./test-dom.js";
import { label } from "./text.js";

let dom: DomHarness;
let messages: string[] = [];
const scenes: Scene[] = [];

beforeEach(() => {
	dom = installDom({ width: 800, height: 450 });
	messages = [];
	for (const level of ["warn", "error"] as const) {
		vi.spyOn(console, level).mockImplementation((...args) => {
			messages.push(`${level}: ${args.map(String).join(" ")}`);
		});
	}
});

afterEach(() => {
	for (const scene of scenes.splice(0)) scene.dispose();
	vi.restoreAllMocks();
	dom.restore();
});

function mount(options: SceneOptions): Scene {
	const scene = createScene({ host: mountPoint(), ...options });
	scenes.push(scene);
	return scene;
}

/** A small scene with a shape of each common kind, a group and a label. */
function populate(scene: Scene) {
	const position = trackPoint(-2, 0);
	scene.add(
		rect.create({ center: position, width: 1, height: 1, fill: "#888" }),
	);
	const inner = scene.add(group.create({ x: 1, scale: 2 }));
	inner.add(circle.create({ radius: 0.5 }));
	scene.add(label.create({ text: "hello", y: -2 }));
	return position;
}

describe("a mounted scene logs nothing", () => {
	it("mounting, reframing and animating a plain scene", async () => {
		const clock = createClock();
		const units = track(16);
		const scene = mount({ units, clock });
		const position = populate(scene);
		const run = scene.play(moveTo(position, { x: 2, y: 1 }, { duration: 0.2 }));
		for (let frame = 0; frame < 30; frame++) {
			if (frame === 5) units.set(8);
			if (frame === 10) scene.setView({ center: { x: 1, y: 1 }, yUp: false });
			dom.runFrame(1000 + frame * 16);
		}
		expect(await run).toBe("done");
		expect(messages).toEqual([]);
	});

	it("mounting and reframing a scene with cameras", () => {
		const scene = mount({ units: 16 });
		populate(scene);
		splitScreen(scene, { panes: [{}, { units: 4 }] });
		dom.drain();
		scene.setView({ units: 8 });
		dom.drain();
		expect(messages).toEqual([]);
	});
});

/** One camera pass of a paint: its clip box, its view matrix and the shapes' first vertices in scene units. */
interface Pass {
	box: number[];
	view: number[];
	xs: number[];
}

/** Splits a paint's calls into camera passes (each starts with its clip `rect`). */
function passes(calls: readonly Call[]): Pass[] {
	const out: Pass[] = [];
	let current: Pass | null = null;
	let local: number[] | null = null;
	for (const call of calls) {
		if (call.op === "rect") {
			current = { box: call.args as number[], view: [], xs: [] };
			out.push(current);
		} else if (call.op === "setTransform" && current) {
			const args = call.args as number[];
			local = null;
			if (args[0] !== 1 && current.view.length === 0) current.view = args;
		} else if (call.op === "transform") {
			local = call.args as number[];
		} else if (call.op === "moveTo" && current) {
			const [x, y] = call.args as [number, number];
			current.xs.push(
				local ? (local[0] ?? 1) * x + (local[2] ?? 0) * y + (local[4] ?? 0) : x,
			);
		} else if (call.op === "restore") {
			local = null;
		}
	}
	return out;
}

it("two cameras and an animated node never paint a frame mixing new and stale state", async () => {
	const clock = createClock();
	const scene = mount({ units: 10, clock });
	const dot = trackPoint(2, 0);
	scene.add(rect.create({ center: dot, width: 0.2, height: 0.2 }));
	pictureInPicture(scene, {
		main: {},
		inset: { units: 4, center: dot, border: "#f00" },
		corner: "bottom-left",
	});
	const run = scene.play(
		sequence(
			moveTo(dot, { x: 0, y: 2 }, { duration: 0.1 }),
			moveTo(dot, { x: -2, y: 0 }, { duration: 0.1 }),
			moveTo(dot, { x: 0, y: -2 }, { duration: 0.1 }),
			moveTo(dot, { x: 2, y: 0 }, { duration: 0.1 }),
		),
	);
	let checked = 0;
	for (let frame = 0; frame < 40; frame++) {
		dom.takeCalls();
		dom.runFrame(1000 + frame * 16);
		const made = dom.takeCalls();
		for (const pass of passes(made)) {
			// The main camera spans the canvas; the inset is the small pane.
			if (pass.box[2] === 800 || pass.view.length === 0) continue;
			const [x = 0, , width = 0] = pass.box;
			const [scale = 1, , , , offsetX = 0] = pass.view;
			// The view centres the camera's `center` in its box.
			const cameraX = (x + width / 2 - offsetX) / scale;
			const nodeX = (pass.xs[0] ?? Number.NaN) + 0.1;
			expect(nodeX).toBeCloseTo(cameraX, 9);
			checked++;
		}
	}
	expect(await run).toBe("done");
	expect(checked).toBeGreaterThan(10);
	expect(messages).toEqual([]);
});
