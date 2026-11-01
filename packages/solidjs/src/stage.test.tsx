/**
 * `<Stage>`, `<Camera>` and the hooks: reactive stage props reach the scene,
 * contexts flow through the stage, cameras follow their props,
 * `useTrackValue` re-renders DOM, `usePlayer` plays and seeks on the scene's
 * clock and aborts on cleanup.
 */

import { render } from "@solidjs/web";
import type { Scene, SceneNode } from "@sophistry/core";
import { createClock, defaultClock, track, valueTo } from "@sophistry/core";
import { createContext, createSignal, flush, Show, useContext } from "solid-js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useClock, useScene } from "./context.js";
import { Circle } from "./generated/core.gen.js";
import type { UsePlayerResult } from "./hooks.js";
import {
	useMovablePoint,
	usePlayer,
	useTrack,
	useTrackValue,
} from "./hooks.js";
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

describe("<Stage>", () => {
	it("renders a div holding the scene's box and canvas", () => {
		const host = mountPoint();
		let scene: Scene | undefined;
		render(
			() => (
				<Stage
					style={{ width: "300px" }}
					class="figure"
					ref={(created) => {
						scene = created;
					}}
				/>
			),
			host,
		);
		const outer = host.firstElementChild as HTMLElement;
		expect(outer.tagName).toBe("DIV");
		expect(outer.style.width).toBe("300px");
		expect(scene?.element?.parentElement).toBe(outer);
		expect(outer.className).toBe("figure");
		expect(scene?.element?.className).toBe("w-full overflow-hidden rounded-xl");
		expect(outer.querySelector("canvas")).toBe(scene?.canvas);
	});

	it("styles the outer div with class and the scene's box with boxClass", () => {
		const host = mountPoint();
		const [outerClass, setOuterClass] = createSignal("figure");
		const [boxClass, setBoxClass] = createSignal<string | undefined>("box");
		let scene: Scene | undefined;
		render(
			() => (
				<Stage
					class={outerClass()}
					boxClass={boxClass()}
					ref={(created) => {
						scene = created;
					}}
				/>
			),
			host,
		);
		const outer = host.firstElementChild as HTMLElement;
		expect(outer.className).toBe("figure");
		expect(scene?.element?.className).toBe("box");
		setOuterClass("wide");
		setBoxClass("rounded-none");
		flush();
		expect(outer.className).toBe("wide");
		expect(scene?.element?.className).toBe("rounded-none");
		setBoxClass(undefined);
		flush();
		expect(scene?.element?.className).toBe("w-full overflow-hidden rounded-xl");
	});

	it("follows units, center and yUp with setView, binding Readables", () => {
		const [units, setUnits] = createSignal(16);
		const center = track({ x: 0, y: 0 });
		let scene: Scene | undefined;
		render(
			() => (
				<Stage
					units={units()}
					center={center}
					ref={(created) => {
						scene = created;
					}}
				/>
			),
			mountPoint(),
		);
		const frame = () => (scene as Scene).frame.peek();
		expect(frame().maxX - frame().minX).toBe(16);
		setUnits(8);
		flush();
		expect(frame().maxX - frame().minX).toBe(8);
		center.set({ x: 10, y: 0 });
		expect((frame().maxX + frame().minX) / 2).toBe(10);
	});

	it("follows theme props and background", () => {
		const [background, setBackground] = createSignal<string>("theme");
		const [mode, setMode] = createSignal<"light" | "dark">("light");
		let scene: Scene | undefined;
		render(
			() => (
				<Stage
					mode={mode()}
					background={background()}
					ref={(created) => {
						scene = created;
					}}
				/>
			),
			mountPoint(),
		);
		const light = scene?.theme.peek();
		setMode("dark");
		flush();
		expect(scene?.theme.peek()).not.toBe(light);
		expect(scene?.theme.peek().mode).toBe("dark");
		setBackground("transparent");
		flush();
		expect(scene?.background.peek()).toBeNull();
	});

	it("provides the scene and clock, and lets outer contexts through", () => {
		const Outer = createContext<string>("none");
		const clock = createClock();
		const seen: unknown[] = [];
		function Probe() {
			seen.push(useScene(), useClock(), useContext(Outer));
			return null;
		}
		let scene: Scene | undefined;
		render(
			() => (
				<Outer value="outer">
					<Stage
						clock={clock}
						ref={(created) => {
							scene = created;
						}}
					>
						<Probe />
					</Stage>
				</Outer>
			),
			mountPoint(),
		);
		expect(seen).toEqual([scene, clock, "outer"]);
	});

	it("useScene throws outside a stage; useClock falls back to defaultClock", () => {
		let error: unknown;
		let clock: unknown;
		function Probe() {
			clock = useClock();
			try {
				useScene();
			} catch (caught) {
				error = caught;
			}
			return null;
		}
		render(() => <Probe />, mountPoint());
		expect(String(error)).toContain("<Stage>");
		expect(clock).toBe(defaultClock);
	});

	it("disposes the scene on unmount", () => {
		let scene: Scene | undefined;
		const dispose = render(
			() => (
				<Stage
					ref={(created) => {
						scene = created;
					}}
				>
					<Circle radius={1} />
				</Stage>
			),
			mountPoint(),
		);
		const node = scene?.root.children[0] as SceneNode;
		dispose();
		expect(node.disposed).toBe(true);
		expect(scene?.root.disposed).toBe(true);
		expect(scene?.element?.isConnected ?? false).toBe(false);
	});
});

describe("<Camera>", () => {
	it("adds a camera that follows its props and leaves on cleanup", () => {
		const [units, setUnits] = createSignal(4);
		const [shown, setShown] = createSignal(true);
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
					<Show when={shown()}>
						<Camera
							units={units()}
							viewport={{ x: 0, y: 0, width: 0.5, height: 1 }}
						/>
					</Show>
				</MultiStage>
			),
			mountPoint(),
		);
		const views = () => (scene as Scene).cameraViews.peek();
		expect(views().map((view) => view.units)).toEqual([4]);
		setUnits(2);
		flush();
		expect(views().map((view) => view.units)).toEqual([2]);
		expect(views()[0]?.viewport.width).toBe(0.5);
		setShown(false);
		flush();
		expect(views()).toEqual([]);
		expect(scene?.root.children).toHaveLength(1);
	});

	it("paints in JSX order, also for a camera shown later", () => {
		const [shown, setShown] = createSignal(false);
		const [swapped, setSwapped] = createSignal(false);
		let scene: Scene | undefined;
		render(
			() => (
				<MultiStage
					ref={(created) => {
						scene = created;
					}}
				>
					<Show when={shown()}>
						<Camera units={1} />
					</Show>
					<Show
						when={swapped()}
						fallback={
							<>
								<Camera units={2} />
								<Circle radius={1} />
								<Camera units={3} />
							</>
						}
					>
						<Camera units={3} />
						<Camera units={2} />
					</Show>
				</MultiStage>
			),
			mountPoint(),
		);
		const order = () => {
			(scene as Scene).commit();
			return (scene as Scene).cameraViews.peek().map((view) => view.units);
		};
		expect(order()).toEqual([2, 3]);
		setShown(true);
		flush();
		// Mounted last, but first in JSX: painted first (under the others).
		expect(order()).toEqual([1, 2, 3]);
		setSwapped(true);
		flush();
		expect(order()).toEqual([1, 3, 2]);
	});
});

describe("hooks", () => {
	it("useTrackValue re-renders DOM text on Track writes and unsubscribes on cleanup", () => {
		const radius = useTrack(1);
		let subscribers = 0;
		const counted = {
			peek: () => radius.peek(),
			subscribe(onStale: () => void) {
				subscribers++;
				const stop = radius.subscribe(onStale);
				return () => {
					subscribers--;
					stop();
				};
			},
		};
		const host = mountPoint();
		function Readout() {
			const value = useTrackValue(counted);
			return <span>r = {value()}</span>;
		}
		const dispose = render(() => <Readout />, host);
		expect(host.textContent).toBe("r = 1");
		radius.set(2.5);
		flush();
		expect(host.textContent).toBe("r = 2.5");
		expect(subscribers).toBe(1);
		dispose();
		expect(subscribers).toBe(0);
	});

	it("usePlayer plays and seeks on the stage's clock, and aborts on cleanup", async () => {
		const clock = createClock();
		const value = track(0);
		let player: UsePlayerResult | undefined;
		function Script() {
			player = usePlayer();
			return null;
		}
		const dispose = render(
			() => (
				<Stage clock={clock} reducedMotion="no-preference">
					<Script />
				</Stage>
			),
			mountPoint(),
		);
		if (!player) throw new Error("no player");
		expect(player.clock).toBe(clock);

		const run = player.play(
			valueTo(value, 1, { duration: 1, easing: "linear" }),
		);
		clock.advance(0.5);
		expect(value.peek()).toBeCloseTo(0.5);
		clock.advance(0.5);
		expect(await run).toBe("done");
		expect(value.peek()).toBe(1);

		const timeline = player.timeline(
			valueTo(value, 3, { duration: 2, easing: "linear" }),
		);
		timeline.seek(1);
		expect(value.peek()).toBeCloseTo(2);

		const pending = player.play(valueTo(value, 10, { duration: 5 }));
		dispose();
		expect(await pending).toBe("aborted");
		expect(player.signal.aborted).toBe(true);
	});

	it("useMovablePoint returns a point track and draggable props", () => {
		let node: SceneNode | undefined;
		function Handle() {
			const point = useMovablePoint({ x: 1, y: 2 });
			return (
				<Circle
					center={point.position}
					radius={0.2}
					label="handle"
					{...point.props}
					ref={(created) => {
						node = created;
					}}
				/>
			);
		}
		render(
			() => (
				<Stage>
					<Handle />
				</Stage>
			),
			mountPoint(),
		);
		expect(node?.get("center" as never)).toEqual({ x: 1, y: 2 });
		expect(node?.get("drag" as never)).toBeTypeOf("object");
		expect(node?.get("keyboard" as never)).toBeTypeOf("object");
	});
});
