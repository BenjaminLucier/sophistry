/**
 * `<Stage>` and the hooks: scene creation and reactive props, the context
 * bridge, cameras, `useTrackValue`, `usePlayer`, `useClock`, `useScene` and
 * `useMovablePoint`.
 */

import type {
	Bounds,
	CircleProps,
	Clock,
	Scene,
	SceneNode,
	ShapeNode,
} from "@sophistry/core";
import { createClock, defaultClock, track, valueTo } from "@sophistry/core";
import { act, cleanup, render } from "@testing-library/react";
import { FiberProvider } from "its-fine";
import { createContext, createRef, StrictMode, useContext } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Camera } from "./camera.js";
import { Circle } from "./generated/core.gen.js";
import {
	type Player,
	useClock,
	useMovablePoint,
	usePlayer,
	useScene,
	useTrack,
	useTrackValue,
} from "./hooks.js";
import { Stage } from "./stage.js";
import { type DomHarness, installDom } from "./test-dom.js";

let dom: DomHarness;

beforeEach(() => {
	dom = installDom();
});

afterEach(() => {
	cleanup();
	dom.restore();
	vi.restoreAllMocks();
});

const width = (box: Bounds) => box.maxX - box.minX;

describe("<Stage>", () => {
	it("creates a scene in its div and hands it to ref", () => {
		const ref = createRef<Scene>();
		const { container } = render(
			<Stage ref={ref} className="figure" units={8} />,
		);
		const scene = ref.current as Scene;
		const div = container.querySelector("div.figure") as HTMLElement;
		expect(scene.element?.parentElement).toBe(div);
		expect(div.querySelector("canvas")).toBe(scene.canvas);
		expect(width(scene.frame.peek())).toBe(8);
	});

	it("styles the outer div with className and the scene's box with boxClass", () => {
		const ref = createRef<Scene>();
		const view = render(<Stage ref={ref} className="figure" boxClass="box" />);
		const scene = ref.current as Scene;
		const div = view.container.firstElementChild as HTMLElement;
		expect(div.className).toBe("figure");
		expect(scene.element?.className).toBe("box");
		view.rerender(<Stage ref={ref} className="wide" boxClass="rounded-none" />);
		expect(div.className).toBe("wide");
		expect(scene.element?.className).toBe("rounded-none");
		view.rerender(<Stage ref={ref} className="wide" />);
		expect(scene.element?.className).toBe("w-full overflow-hidden rounded-xl");
	});

	it("applies reactive props to the scene", () => {
		const ref = createRef<Scene>();
		const view = render(<Stage ref={ref} units={8} />);
		const scene = ref.current as Scene;
		view.rerender(<Stage ref={ref} units={4} center={{ x: 1, y: 0 }} />);
		expect(ref.current).toBe(scene);
		expect(width(scene.frame.peek())).toBe(4);
		expect(scene.frame.peek().minX).toBe(-1);

		const setTheme = vi.spyOn(scene, "setTheme");
		view.rerender(
			<Stage ref={ref} units={4} center={{ x: 1, y: 0 }} mode="light" />,
		);
		expect(setTheme).toHaveBeenCalledWith({
			theme: undefined,
			palette: undefined,
			mode: "light",
		});
		view.rerender(
			<Stage ref={ref} units={4} center={{ x: 1, y: 0 }} mode="light" />,
		);
		expect(setTheme).toHaveBeenCalledTimes(1);

		view.rerender(
			<Stage
				ref={ref}
				units={4}
				center={{ x: 1, y: 0 }}
				mode="light"
				background="transparent"
			/>,
		);
		expect(scene.background.peek()).toBeNull();
	});

	it("binds a Readable units", () => {
		const units = track(10);
		const ref = createRef<Scene>();
		render(<Stage ref={ref} units={units} />);
		const scene = ref.current as Scene;
		expect(width(scene.frame.peek())).toBe(10);
		units.set(6);
		expect(width(scene.frame.peek())).toBe(6);
	});

	it("warns when a creation-only prop changes", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const view = render(<Stage clock={createClock()} />);
		view.rerender(<Stage clock={createClock()} />);
		expect(warn).toHaveBeenCalledWith(expect.stringMatching(/<Stage clock>/));
	});

	it("disposes the scene on unmount, and survives StrictMode's double mount", () => {
		const ref = createRef<Scene>();
		const nodeRef = createRef<ShapeNode<CircleProps>>();
		const view = render(
			<StrictMode>
				<Stage ref={ref}>
					<Circle ref={nodeRef} radius={1} />
				</Stage>
			</StrictMode>,
		);
		const scene = ref.current as Scene;
		const node = nodeRef.current as SceneNode;
		expect(scene.root.disposed).toBe(false);
		expect(scene.root.children).toEqual([node]);
		view.unmount();
		expect(ref.current).toBeNull();
		expect(scene.root.disposed).toBe(true);
		expect(node.disposed).toBe(true);
	});
});

describe("context bridge", () => {
	const Theme = createContext("default");
	const Other = createContext(0);

	it("makes contexts from above the stage readable inside it", () => {
		const seen: [string, number][] = [];
		function Reader() {
			seen.push([useContext(Theme), useContext(Other)]);
			return <Circle radius={1} />;
		}
		const view = (theme: string) => (
			<Other value={7}>
				<Theme value={theme}>
					<Stage>
						<Reader />
					</Stage>
				</Theme>
			</Other>
		);
		const { rerender } = render(view("outer"));
		expect(seen.at(-1)).toEqual(["outer", 7]);
		rerender(view("changed"));
		expect(seen.at(-1)).toEqual(["changed", 7]);
	});

	it("bridges under StrictMode and inside an app's own FiberProvider", () => {
		const seen: string[] = [];
		function Reader() {
			seen.push(useContext(Theme));
			return null;
		}
		render(
			<StrictMode>
				<FiberProvider>
					<Theme value="app">
						<Stage>
							<Reader />
						</Stage>
					</Theme>
				</FiberProvider>
			</StrictMode>,
		);
		expect(seen.length).toBeGreaterThan(0);
		expect(new Set(seen)).toEqual(new Set(["app"]));
	});

	it("provides the scene to useScene and useClock", () => {
		const clock = createClock();
		const ref = createRef<Scene>();
		let found: { scene: Scene; clock: Clock } | null = null;
		function Probe() {
			found = { scene: useScene(), clock: useClock() };
			return null;
		}
		render(
			<Stage ref={ref} clock={clock}>
				<Probe />
			</Stage>,
		);
		expect(found).toEqual({ scene: ref.current, clock });
	});

	it("useClock is defaultClock outside a stage; useScene throws", () => {
		let clock: Clock | null = null;
		function Outside() {
			clock = useClock();
			return null;
		}
		render(<Outside />);
		expect(clock).toBe(defaultClock);
		vi.spyOn(console, "error").mockImplementation(() => {});
		function Lost() {
			useScene();
			return null;
		}
		expect(() => render(<Lost />)).toThrow(/inside a <Stage>/);
	});
});

describe("<Camera>", () => {
	it("adds a camera while mounted and follows its props", () => {
		const ref = createRef<Scene>();
		const viewport = { x: 0, y: 0, width: 0.5, height: 1 };
		const view = (units: number, show = true) => (
			<Stage ref={ref}>
				{show && <Camera viewport={viewport} units={units} />}
			</Stage>
		);
		const { rerender } = render(view(4));
		const scene = ref.current as Scene;
		expect(scene.cameraViews.peek()).toHaveLength(1);
		expect(scene.cameraViews.peek()[0]?.units).toBe(4);
		rerender(view(2));
		expect(scene.cameraViews.peek()[0]?.units).toBe(2);
		rerender(view(2, false));
		expect(scene.cameraViews.peek()).toHaveLength(0);
	});

	it("paints in JSX order, also for a camera mounted later or moved", () => {
		const ref = createRef<Scene>();
		const view = (first: boolean, swapped: boolean) => {
			const cameras = [
				<Camera key="two" units={2} />,
				<Circle key="circle" radius={1} />,
				<Camera key="three" units={3} />,
			];
			return (
				<Stage ref={ref}>
					{first && <Camera units={1} />}
					{swapped ? cameras.reverse() : cameras}
				</Stage>
			);
		};
		const { rerender } = render(view(false, false));
		const scene = ref.current as Scene;
		const order = () => {
			scene.commit();
			return scene.cameraViews.peek().map((camera) => camera.units);
		};
		expect(order()).toEqual([2, 3]);
		rerender(view(true, false));
		// Mounted last, but first in JSX: painted first (under the others).
		expect(order()).toEqual([1, 2, 3]);
		rerender(view(true, true));
		expect(order()).toEqual([1, 3, 2]);
	});
});

describe("useTrackValue", () => {
	it("re-renders on track writes", () => {
		const value = track(1);
		const seen: number[] = [];
		function Readout() {
			seen.push(useTrackValue(value));
			return null;
		}
		render(<Readout />);
		act(() => value.set(2));
		act(() => value.set(3));
		expect(seen).toEqual([1, 2, 3]);
	});
});

describe("usePlayer", () => {
	it("plays and seeks on the stage's clock, and aborts on unmount", async () => {
		const clock = createClock({ reducedMotion: "no-preference" });
		let player: Player | null = null;
		let radius: ReturnType<typeof track<number>> | null = null;
		function Script() {
			player = usePlayer();
			radius = useTrack(1);
			return <Circle radius={radius} />;
		}
		const view = render(
			<Stage clock={clock}>
				<Script />
			</Stage>,
		);
		const active = player as unknown as Player;
		const value = radius as unknown as ReturnType<typeof track<number>>;
		expect(active.clock).toBe(clock);

		const done = active.play(
			valueTo(value, 3, { duration: 1, easing: "linear" }),
		);
		clock.advance(0.5);
		expect(value.peek()).toBeCloseTo(2);
		clock.advance(0.6);
		await expect(done).resolves.toBe("done");
		expect(value.peek()).toBe(3);

		const timeline = active.timeline(
			valueTo(value, 5, { duration: 2, easing: "linear" }),
		);
		timeline.seek(1);
		expect(value.peek()).toBeCloseTo(4);
		timeline.seek(0);
		expect(value.peek()).toBeCloseTo(3);

		const pending = active.play(valueTo(value, 10, { duration: 1 }));
		clock.advance(0.1);
		view.unmount();
		await expect(pending).resolves.toBe("aborted");
	});

	it("is the same object across renders", () => {
		const players: Player[] = [];
		function Script(_: { tick: number }) {
			players.push(usePlayer());
			return null;
		}
		const view = render(<Script tick={0} />);
		view.rerender(<Script tick={1} />);
		expect(players[0]).toBe(players[1]);
		expect(players[0]?.clock).toBe(defaultClock);
	});
});

describe("useMovablePoint", () => {
	it("hands back a position track and draggable props for the shape", () => {
		const ref = createRef<ShapeNode<CircleProps>>();
		let position: ReturnType<typeof useMovablePoint>["position"] | null = null;
		function Handle() {
			const movable = useMovablePoint({ x: 1, y: 2 });
			position = movable.position;
			return (
				<Circle
					ref={ref}
					center={movable.position}
					radius={0.2}
					label="handle"
					{...movable.props}
				/>
			);
		}
		render(
			<Stage>
				<Handle />
			</Stage>,
		);
		const node = ref.current as SceneNode<{
			center: { x: number; y: number };
			drag: unknown;
			keyboard: unknown;
		}>;
		expect(node.get("center")).toEqual({ x: 1, y: 2 });
		expect(node.get("drag")).toBeDefined();
		expect(node.get("keyboard")).toBeDefined();
		act(() => position?.set({ x: 3, y: 0 }));
		expect(node.get("center")).toEqual({ x: 3, y: 0 });
	});
});
