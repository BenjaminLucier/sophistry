/**
 * The camera list and the layout helpers, on headless scenes: cameras resolve
 * against the scene's framing and background, keep creation order and view
 * identity, follow bound inputs, and the layouts arrange the
 * split-screen, picture-in-picture and quad-view viewports.
 */

import { afterEach, describe, expect, it } from "vitest";
import { BLUE } from "../color/index.js";
import { track } from "../reactive/index.js";
import {
	FULL_VIEWPORT,
	pictureInPictureViewports,
	quadViewports,
	splitViewports,
} from "../render/camera.js";
import { resolveTheme } from "../themes/theme.js";
import { pictureInPicture, quadView, splitScreen } from "./cameras.js";
import { group } from "./group.js";
import type { Scene } from "./scene.js";
import { createScene } from "./scene.js";

const scenes: Scene[] = [];
afterEach(() => {
	for (const scene of scenes.splice(0)) scene.dispose();
});

function headless(options: Parameters<typeof createScene>[0] = {}): Scene {
	const scene = createScene({ headless: true, mode: "dark", ...options });
	scenes.push(scene);
	return scene;
}

describe("scene.addCamera", () => {
	it("falls back to the scene's framing and background", () => {
		const scene = headless({ units: 12, center: { x: 1, y: 2 }, yUp: false });
		const camera = scene.addCamera();
		expect(camera.view.peek()).toEqual({
			units: 12,
			center: { x: 1, y: 2 },
			yUp: false,
			viewport: FULL_VIEWPORT,
			border: null,
			borderWidth: 2,
			background: resolveTheme({ mode: "dark" }).palette.background,
		});
	});

	it("resolves its own options, colours as CSS", () => {
		const scene = headless({ background: "transparent" });
		const view = scene
			.addCamera({
				units: 4,
				center: { x: 3, y: 0 },
				yUp: false,
				viewport: { x: 0.5, y: 0, width: 0.5, height: 1 },
				border: BLUE,
				borderWidth: 4,
			})
			.view.peek();
		expect(view.units).toBe(4);
		expect(view.center).toEqual({ x: 3, y: 0 });
		expect(view.border).toBe(BLUE);
		expect(view.borderWidth).toBe(4);
		// A transparent scene's cameras leave their viewport unfilled.
		expect(view.background).toBeNull();
	});

	it("keeps creation order and the views' identity while nothing changes", () => {
		const scene = headless();
		scene.addCamera({ units: 10 });
		const middle = scene.addCamera({ units: 20 });
		scene.addCamera({ units: 30 });
		const first = scene.cameraViews.peek();
		expect(first.map((view) => view.units)).toEqual([10, 20, 30]);
		expect(scene.cameraViews.peek()).toBe(first);
		// An update to an equal view re-publishes nothing.
		middle.update({ units: 20 });
		expect(scene.cameraViews.peek()).toBe(first);
		middle.update({ units: 25 });
		const second = scene.cameraViews.peek();
		expect(second).not.toBe(first);
		expect(second[0]).toBe(first[0]);
		expect(second[2]).toBe(first[2]);
		middle.dispose();
		expect(scene.cameraViews.peek().map((view) => view.units)).toEqual([
			10, 30,
		]);
		expect(middle.disposed).toBe(true);
	});

	it("follows bound inputs and the scene's framing", () => {
		const scene = headless({ units: 16 });
		const center = track({ x: 0, y: 0 });
		const camera = scene.addCamera({ center });
		let stale = 0;
		const stop = scene.cameraViews.subscribe(() => stale++);
		center.set({ x: 2, y: 1 });
		expect(stale).toBeGreaterThan(0);
		expect(camera.view.peek().center).toEqual({ x: 2, y: 1 });
		scene.setView({ units: 8 });
		expect(camera.view.peek().units).toBe(8);
		// `undefined` goes back to the default.
		camera.update({ center: undefined });
		expect(camera.view.peek().center).toEqual({ x: 0, y: 0 });
		const count = stale;
		center.set({ x: 5, y: 5 }); // unbound now
		expect(stale).toBe(count);
		stop();
	});

	it("binds a Readable border and background", () => {
		const scene = headless();
		const border = track<string | null>("#ff0000");
		const background = track<string | null>("#000000");
		const camera = scene.addCamera({ border, background });
		let stale = 0;
		const stop = scene.cameraViews.subscribe(() => stale++);
		expect(camera.view.peek().border).toBe("#ff0000");
		expect(camera.view.peek().background).toBe("#000000");
		border.set(BLUE);
		background.set(null);
		expect(stale).toBeGreaterThan(0);
		expect(camera.view.peek().border).toBe(BLUE);
		expect(camera.view.peek().background).toBeNull();
		border.set(null);
		expect(camera.view.peek().border).toBeNull();
		stop();
	});

	it("paints anchored cameras in their anchors' tree order, re-sorted on moves", () => {
		const scene = headless();
		const unitsOf = () => scene.cameraViews.peek().map((view) => view.units);
		const first = group.create({});
		const nested = group.create({});
		const holder = group.create({ children: [nested] });
		const last = group.create({});
		// Created out of tree order, plus one without an anchor.
		scene.addCamera({ units: 3, anchor: last });
		scene.addCamera({ units: 99 });
		scene.addCamera({ units: 2, anchor: nested });
		scene.addCamera({ units: 1, anchor: first });
		// Anchors not in the scene yet count as none: creation order.
		expect(unitsOf()).toEqual([3, 99, 2, 1]);
		scene.root.setChildren([first, holder, last]);
		let stale = 0;
		const stop = scene.cameraViews.subscribe(() => stale++);
		scene.commit();
		expect(stale).toBeGreaterThan(0);
		expect(unitsOf()).toEqual([1, 2, 3, 99]);
		// Moving an anchor re-sorts after the next commit.
		scene.root.setChildren([last, holder, first]);
		scene.commit();
		expect(unitsOf()).toEqual([3, 2, 1, 99]);
		// A removed (disposed) anchor counts as none.
		scene.root.remove(holder);
		scene.commit();
		expect(unitsOf()).toEqual([3, 1, 99, 2]);
		stop();
	});

	it("keeps the views' identity when a structure change leaves the order alone", () => {
		const scene = headless();
		const anchor = group.create({});
		scene.root.add(anchor);
		scene.addCamera({ units: 4, anchor });
		scene.commit();
		const views = scene.cameraViews.peek();
		scene.root.add(group.create({}));
		scene.commit();
		expect(scene.cameraViews.peek()).toBe(views);
	});
});

describe("layouts", () => {
	it("splitScreen arranges two panes and re-lays them out", () => {
		const scene = headless();
		const split = splitScreen(scene, {
			panes: [{ units: 4 }, {}],
			split: "vertical",
		});
		expect(scene.cameraViews.peek().map((view) => view.viewport)).toEqual(
			splitViewports("vertical", 0.5),
		);
		expect(scene.cameraViews.peek()[0]?.units).toBe(4);
		split.update({ ratio: 0.25 });
		expect(scene.cameraViews.peek().map((view) => view.viewport)).toEqual(
			splitViewports("vertical", 0.25),
		);
		split.dispose();
		expect(scene.cameraViews.peek()).toEqual([]);
	});

	it("pictureInPicture puts the inset after (over) the main view", () => {
		const scene = headless();
		const pip = pictureInPicture(scene, {
			main: {},
			inset: { units: 2 },
			corner: "bottom-left",
			size: 0.25,
		});
		expect(scene.cameraViews.peek().map((view) => view.viewport)).toEqual(
			pictureInPictureViewports("bottom-left", 0.25, 0.02),
		);
		pip.update({ corner: "top-right" });
		expect(scene.cameraViews.peek()[1]?.viewport).toEqual(
			pictureInPictureViewports("top-right", 0.25, 0.02)[1],
		);
		expect(pip.cameras[1].view.peek().units).toBe(2);
	});

	it("quadView makes four panes in reading order", () => {
		const scene = headless();
		quadView(scene, {
			panes: [{ units: 1 }, { units: 2 }, { units: 3 }, { units: 4 }],
		});
		const views = scene.cameraViews.peek();
		expect(views.map((view) => view.viewport)).toEqual(quadViewports());
		expect(views.map((view) => view.units)).toEqual([1, 2, 3, 4]);
	});
});
