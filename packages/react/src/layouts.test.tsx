/**
 * The camera layouts arrange viewports and follow their props,
 * `<PanZoom>`/`usePanZoom` navigate while mounted, `useTheme` follows the
 * stage's theme, and `<Camera>` binds a Readable border.
 */

import type { PanZoomController, Scene, Theme } from "@sophistry/core";
import {
	BLUE,
	pictureInPictureViewports,
	quadViewports,
	resolveTheme,
	splitViewports,
	track,
	trackPoint,
} from "@sophistry/core";
import { cleanup, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Camera } from "./camera";
import { Circle } from "./generated/core.gen";
import { useTheme } from "./hooks";
import { PictureInPicture, QuadView, SplitScreen } from "./layouts";
import { PanZoom } from "./pan-zoom";
import { MultiStage, Stage } from "./stage";
import { type DomHarness, installDom } from "./test-dom";

let dom: DomHarness;
beforeEach(() => {
	dom = installDom();
});
afterEach(() => {
	cleanup();
	dom.restore();
});

/** The scene's camera views, after a commit (anchored cameras sort then). */
function viewsOf(scene: Scene | null) {
	(scene as Scene).commit();
	return (scene as Scene).cameraViews.peek();
}

describe("camera layouts", () => {
	it("<SplitScreen> arranges two panes and follows ratio and split", () => {
		const ref = createRef<Scene>();
		const view = (ratio: number, split: "horizontal" | "vertical") => (
			<MultiStage units={10} ref={ref}>
				<Circle radius={1} />
				<SplitScreen
					panes={[{}, { units: 4, center: { x: 2, y: 0 } }]}
					ratio={ratio}
					split={split}
				/>
			</MultiStage>
		);
		const { rerender } = render(view(0.5, "horizontal"));
		let views = viewsOf(ref.current);
		expect(views.map((each) => each.viewport)).toEqual(
			splitViewports("horizontal", 0.5),
		);
		expect(views.map((each) => each.units)).toEqual([10, 4]);
		rerender(view(0.7, "vertical"));
		views = viewsOf(ref.current);
		expect(views.map((each) => each.viewport)).toEqual(
			splitViewports("vertical", 0.7),
		);
	});

	it("<PictureInPicture> paints the inset over the main view, following a bound center", () => {
		const ref = createRef<Scene>();
		const dot = trackPoint(2, 0);
		render(
			<MultiStage units={10} ref={ref}>
				<PictureInPicture
					main={{}}
					inset={{ units: 4, center: dot, border: BLUE }}
					corner="bottom-left"
				/>
			</MultiStage>,
		);
		let views = viewsOf(ref.current);
		expect(views.map((each) => each.viewport)).toEqual(
			pictureInPictureViewports("bottom-left", 0.3, 0.02),
		);
		expect(views[1]?.border).toBe(BLUE);
		dot.set({ x: -1, y: 1 });
		views = viewsOf(ref.current);
		expect(views[1]?.center).toEqual({ x: -1, y: 1 });
	});

	it("<QuadView> arranges four panes in reading order and leaves on unmount", () => {
		const ref = createRef<Scene>();
		const view = (shown: boolean) => (
			<MultiStage ref={ref}>
				{shown && (
					<QuadView
						panes={[{ units: 1 }, { units: 2 }, { units: 3 }, { units: 4 }]}
					/>
				)}
			</MultiStage>
		);
		const { rerender } = render(view(true));
		const views = viewsOf(ref.current);
		expect(views.map((each) => each.units)).toEqual([1, 2, 3, 4]);
		expect(views.map((each) => each.viewport)).toEqual(quadViewports());
		rerender(view(false));
		expect(viewsOf(ref.current)).toEqual([]);
	});

	it("<Camera> binds a Readable border", () => {
		const ref = createRef<Scene>();
		const border = track<string | null>("#ff0000");
		render(
			<MultiStage ref={ref}>
				<Camera border={border} />
			</MultiStage>,
		);
		expect(viewsOf(ref.current)[0]?.border).toBe("#ff0000");
		border.set(null);
		expect(viewsOf(ref.current)[0]?.border).toBeNull();
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

	it("writes the tracks it is given while mounted, and stops when unmounted", () => {
		const units = track(14);
		const center = trackPoint(0, 0);
		const ref = createRef<Scene>();
		const navigation = createRef<PanZoomController | null>();
		const view = (shown: boolean) => (
			<Stage units={units} center={center} ref={ref}>
				{shown && (
					<PanZoom
						ref={navigation}
						units={units}
						center={center}
						minUnits={4}
						maxUnits={40}
					/>
				)}
			</Stage>
		);
		const { rerender } = render(view(true));
		expect(navigation.current?.units).toBe(units);
		wheel(ref.current as Scene);
		expect(units.peek()).toBeLessThan(14);
		navigation.current?.reset();
		expect(units.peek()).toBe(14);
		rerender(view(false));
		expect(navigation.current).toBeNull();
		wheel(ref.current as Scene);
		expect(units.peek()).toBe(14);
	});
});

describe("useTheme", () => {
	it("follows the stage's theme, and the page's default outside a stage", () => {
		let inside: Theme | undefined;
		let outside: Theme | undefined;
		function Probe() {
			inside = useTheme();
			return null;
		}
		function Beside() {
			outside = useTheme();
			return null;
		}
		const view = (mode: "light" | "dark") => (
			<>
				<Beside />
				<Stage mode={mode}>
					<Probe />
				</Stage>
			</>
		);
		const { rerender } = render(view("dark"));
		expect(outside?.palette.background).toBe(resolveTheme().palette.background);
		expect(inside?.palette.background).toBe(
			resolveTheme({ mode: "dark" }).palette.background,
		);
		rerender(view("light"));
		expect(inside?.palette.background).toBe(
			resolveTheme({ mode: "light" }).palette.background,
		);
	});
});
