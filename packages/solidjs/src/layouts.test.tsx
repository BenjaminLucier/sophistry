/**
 * The camera layouts arrange viewports and follow their props,
 * `<PanZoom>`/`usePanZoom` navigate while mounted, `useTheme` follows the
 * stage's theme, and `<Camera>` binds a Readable border.
 */

import { render } from "@solidjs/web";
import type { PanZoomController, Scene } from "@sophistry/core";
import {
	BLUE,
	pictureInPictureViewports,
	quadViewports,
	resolveTheme,
	splitViewports,
	track,
	trackPoint,
} from "@sophistry/core";
import { createSignal, flush, Show } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Circle } from "./generated/core.gen.js";
import { useTheme } from "./hooks.js";
import { PictureInPicture, QuadView, SplitScreen } from "./layouts.js";
import { PanZoom } from "./pan-zoom.js";
import { Camera, MultiStage, Stage } from "./stage.js";
import type { DomHarness } from "./test/dom.js";
import { installDom, mountPoint } from "./test/dom.js";

let dom: DomHarness;
beforeEach(() => {
	dom = installDom();
});
afterEach(() => {
	dom.restore();
});

/** Runs the queued frames (and the ones they queue), a few rounds deep. */
function frames(): void {
	for (let round = 0; round < 4; round++) {
		const callbacks = dom.queue.splice(0);
		for (const callback of callbacks) callback(performance.now());
	}
}

/** The scene's camera views, after a commit (anchored cameras sort then). */
function viewsOf(scene: Scene | undefined) {
	(scene as Scene).commit();
	return (scene as Scene).cameraViews.peek();
}

describe("camera layouts", () => {
	it("<SplitScreen> arranges two panes and follows ratio and split", () => {
		const [ratio, setRatio] = createSignal(0.5);
		const [split, setSplit] = createSignal<"horizontal" | "vertical">(
			"horizontal",
		);
		let scene: Scene | undefined;
		render(
			() => (
				<MultiStage
					units={10}
					ref={(created) => {
						scene = created;
					}}
				>
					<Circle radius={1} />
					<SplitScreen
						panes={[{}, { units: 4, center: { x: 2, y: 0 } }]}
						ratio={ratio()}
						split={split()}
					/>
				</MultiStage>
			),
			mountPoint(),
		);
		let views = viewsOf(scene);
		expect(views.map((view) => view.viewport)).toEqual(
			splitViewports("horizontal", 0.5),
		);
		expect(views.map((view) => view.units)).toEqual([10, 4]);
		expect(views[1]?.center).toEqual({ x: 2, y: 0 });
		setRatio(0.7);
		setSplit("vertical");
		flush();
		views = viewsOf(scene);
		expect(views.map((view) => view.viewport)).toEqual(
			splitViewports("vertical", 0.7),
		);
	});

	it("<PictureInPicture> paints the inset over the main view, following a bound center", () => {
		const dot = trackPoint(2, 0);
		let scene: Scene | undefined;
		render(
			() => (
				<MultiStage
					units={10}
					ref={(created) => {
						scene = created;
					}}
				>
					<PictureInPicture
						main={{}}
						inset={{ units: 4, center: dot, border: BLUE }}
						corner="bottom-left"
					/>
				</MultiStage>
			),
			mountPoint(),
		);
		let views = viewsOf(scene);
		expect(views.map((view) => view.viewport)).toEqual(
			pictureInPictureViewports("bottom-left", 0.3, 0.02),
		);
		expect(views[1]?.border).toBe(BLUE);
		expect(views[1]?.center).toEqual({ x: 2, y: 0 });
		dot.set({ x: -1, y: 1 });
		views = viewsOf(scene);
		expect(views[1]?.center).toEqual({ x: -1, y: 1 });
	});

	it("<QuadView> arranges four panes in reading order and leaves on cleanup", () => {
		const [shown, setShown] = createSignal(true);
		let scene: Scene | undefined;
		render(
			() => (
				<MultiStage
					ref={(created) => {
						scene = created;
					}}
				>
					<Show when={shown()}>
						<QuadView
							panes={[{ units: 1 }, { units: 2 }, { units: 3 }, { units: 4 }]}
						/>
					</Show>
				</MultiStage>
			),
			mountPoint(),
		);
		const views = viewsOf(scene);
		expect(views.map((view) => view.units)).toEqual([1, 2, 3, 4]);
		expect(views.map((view) => view.viewport)).toEqual(quadViewports());
		setShown(false);
		flush();
		expect(viewsOf(scene)).toEqual([]);
	});

	it("<Camera> binds a Readable border and background", () => {
		const border = track<string | null>("#ff0000");
		let scene: Scene | undefined;
		render(
			() => (
				<MultiStage
					ref={(created) => {
						scene = created;
					}}
				>
					<Camera border={border} background={track("#000000")} />
				</MultiStage>
			),
			mountPoint(),
		);
		expect(viewsOf(scene)[0]?.border).toBe("#ff0000");
		expect(viewsOf(scene)[0]?.background).toBe("#000000");
		border.set(null);
		expect(viewsOf(scene)[0]?.border).toBeNull();
	});
});

describe("<PanZoom> and usePanZoom", () => {
	/** A wheel notch at the canvas's middle (happy-dom drops the mouse fields). */
	const wheel = (scene: Scene) => {
		const event = new Event("wheel", { cancelable: true });
		Object.assign(event, {
			clientX: 500,
			clientY: 250,
			deltaX: 0,
			deltaY: -100,
			deltaMode: 0,
		});
		(scene.canvas as HTMLCanvasElement).dispatchEvent(event);
	};

	it("writes the tracks it is given while mounted, and stops when removed", () => {
		const units = track(14);
		const center = trackPoint(0, 0);
		const [shown, setShown] = createSignal(true);
		let scene: Scene | undefined;
		let controller: PanZoomController | undefined;
		render(
			() => (
				<Stage
					units={units}
					center={center}
					ref={(created) => {
						scene = created;
					}}
				>
					<Show when={shown()}>
						<PanZoom
							units={units}
							center={center}
							minUnits={4}
							maxUnits={40}
							ref={(made) => {
								controller = made;
							}}
						/>
					</Show>
				</Stage>
			),
			mountPoint(),
		);
		frames();
		expect(controller?.units).toBe(units);
		expect(
			((scene as Scene).canvas as HTMLCanvasElement).style.touchAction,
		).toBe("none");
		wheel(scene as Scene);
		const zoomed = units.peek();
		expect(zoomed).toBeLessThan(14);
		controller?.reset();
		expect(units.peek()).toBe(14);
		setShown(false);
		flush();
		frames();
		wheel(scene as Scene);
		expect(units.peek()).toBe(14);
	});
});

describe("useTheme", () => {
	it("follows the stage's theme, and the page's default outside a stage", () => {
		const [mode, setMode] = createSignal<"light" | "dark">("dark");
		let inside: (() => string) | undefined;
		function Probe() {
			const theme = useTheme();
			inside = () => theme().palette.background;
			return null;
		}
		let outside: string | undefined;
		function Beside() {
			outside = useTheme()().palette.background;
			return null;
		}
		render(
			() => (
				<>
					<Beside />
					<Stage mode={mode()}>
						<Probe />
					</Stage>
				</>
			),
			mountPoint(),
		);
		expect(outside).toBe(resolveTheme().palette.background);
		expect(inside?.()).toBe(resolveTheme({ mode: "dark" }).palette.background);
		setMode("light");
		flush();
		expect(inside?.()).toBe(resolveTheme({ mode: "light" }).palette.background);
	});
});
