/**
 * Things a binding takes from or gives to the tree around a stage: the clock
 * from `<ClockProvider>`, a prebuilt node as `<Node>`, `<OrbitControls3D>`.
 */

import type { OrbitControls3DController } from "@sophistry/3d";
import type {
	CircleProps,
	Clock,
	InstancesNode,
	Scene,
	SceneNode,
	ShapeNode,
} from "@sophistry/core";
import {
	circle,
	createClock,
	defaultClock,
	pointerDriver,
	track,
} from "@sophistry/core";
import { act, cleanup, render } from "@testing-library/react";
import { createRef, StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClockProvider } from "./context.js";
import { OrbitControls3D } from "./entries/3d.js";
import { Circle } from "./generated/core.gen.js";
import { useClock, usePlayer } from "./hooks.js";
import { Instances } from "./instances.js";
import { Stage } from "./stage.js";
import { type DomHarness, installDom } from "./test-dom.js";

let dom: DomHarness;
beforeEach(() => {
	dom = installDom();
});
afterEach(() => {
	cleanup();
	dom.restore();
});

describe("<ClockProvider>", () => {
	it("is the clock of a stage, usePlayer and useClock below it", () => {
		const clock = createClock();
		const seen: Record<string, Clock> = {};
		function Probe() {
			seen.hook = useClock();
			seen.player = usePlayer().clock;
			return null;
		}
		const ref = createRef<Scene>();
		render(
			<ClockProvider clock={clock}>
				<Probe />
				<Stage ref={ref}>
					<Circle radius={1} />
				</Stage>
			</ClockProvider>,
		);
		expect(seen.hook).toBe(clock);
		expect(seen.player).toBe(clock);
		expect((ref.current as Scene).clock).toBe(clock);
	});

	it("loses to a stage's own clock, and defaults to defaultClock", () => {
		const provided = createClock();
		const own = createClock();
		const owned = createRef<Scene>();
		const plain = createRef<Scene>();
		render(
			<>
				<ClockProvider clock={provided}>
					<Stage ref={owned} clock={own} />
				</ClockProvider>
				<Stage ref={plain} />
			</>,
		);
		expect((owned.current as Scene).clock).toBe(own);
		expect((plain.current as Scene).clock).toBe(defaultClock);
	});

	it("uses the nearest provider", () => {
		const outer = createClock();
		const inner = createClock();
		const ref = createRef<Scene>();
		render(
			<ClockProvider clock={outer}>
				<ClockProvider clock={inner}>
					<Stage ref={ref} />
				</ClockProvider>
			</ClockProvider>,
		);
		expect((ref.current as Scene).clock).toBe(inner);
	});
});

describe("<Instances>", () => {
	const place = (id: number) => ({ x: id, y: 0 });

	it("draws instances() in JSX order, follows props, disposes on unmount", () => {
		const ref = createRef<Scene>();
		const dotsRef =
			createRef<
				InstancesNode<number, CircleProps, ShapeNode<CircleProps>, "center">
			>();
		const view = (data: number[], shown = true) => (
			<StrictMode>
				<Stage ref={ref}>
					<Circle radius={1} />
					{shown ? (
						<Instances
							ref={dotsRef}
							definition={circle}
							data={data}
							itemKey={(id) => id}
							channels={{ center: place }}
							shared={{ radius: 0.2 }}
						/>
					) : null}
					<Circle radius={2} />
				</Stage>
			</StrictMode>
		);
		const { rerender } = render(view([1, 2, 3]));
		const scene = ref.current as Scene;
		const order = () =>
			scene.root.children.map((child: SceneNode) => child.type);
		expect(order()).toEqual(["Circle", "Instances", "Circle"]);
		const dots = dotsRef.current as NonNullable<typeof dotsRef.current>;
		expect(dots.count).toBe(3);
		expect(dots.indexOf(3)).toBe(2);
		rerender(view([3, 4]));
		expect(dots.count).toBe(2);
		expect(dots.indexOf(3)).toBe(0);
		rerender(view([], false));
		expect(order()).toEqual(["Circle", "Circle"]);
		expect(dots.disposed).toBe(true);
	});
});

describe("<OrbitControls3D>", () => {
	it("attaches to the scene's pointer driver and hands out the controller", () => {
		const eye = track({ x: 6, y: 4, z: 8 });
		const ref = createRef<OrbitControls3DController | null>();
		const scene = createRef<Scene>();
		const { unmount } = render(
			<Stage ref={scene}>
				<OrbitControls3D eye={eye} ref={ref} />
			</Stage>,
		);
		expect(pointerDriver(scene.current as Scene)).not.toBeNull();
		expect(typeof ref.current?.reset).toBe("function");
		act(() => ref.current?.update({ target: { x: 1, y: 0, z: 0 } }));
		unmount();
	});
});
