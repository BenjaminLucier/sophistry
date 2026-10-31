/**
 * Things a binding takes from the tree around a stage: the clock from
 * `<ClockProvider>`; an `instances()` node as a child; `<OrbitControls3D>`.
 */

import { render } from "@solidjs/web";
import type { OrbitControls3DController } from "@sophistry/3d";
import type { Clock, Scene } from "@sophistry/core";
import {
	circle,
	createClock,
	defaultClock,
	instances,
	pointerDriver,
	track,
} from "@sophistry/core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ClockProvider } from "./clock";
import { useClock } from "./context";
import { OrbitControls3D } from "./entries/3d";
import { usePlayer } from "./hooks";
import { Stage } from "./stage";
import type { DomHarness } from "./test/dom";
import { installDom, mountPoint } from "./test/dom";

let dom: DomHarness;
beforeEach(() => {
	dom = installDom();
});
afterEach(() => {
	dom.restore();
});

describe("<ClockProvider>", () => {
	it("is the clock of a stage, usePlayer and useClock below it", () => {
		const clock = createClock();
		const seen: Record<string, Clock> = {};
		let scene: Scene | undefined;
		function Probe() {
			seen.hook = useClock();
			seen.player = usePlayer().clock;
			return null;
		}
		render(
			() => (
				<ClockProvider clock={clock}>
					<Probe />
					<Stage ref={(created) => (scene = created)} />
				</ClockProvider>
			),
			mountPoint(),
		);
		expect(seen.hook).toBe(clock);
		expect(seen.player).toBe(clock);
		expect(scene?.clock).toBe(clock);
	});

	it("loses to a stage's own clock, and defaults to defaultClock", () => {
		const own = createClock();
		let owned: Scene | undefined;
		let plain: Scene | undefined;
		render(
			() => (
				<>
					<ClockProvider clock={createClock()}>
						<Stage clock={own} ref={(created) => (owned = created)} />
					</ClockProvider>
					<Stage ref={(created) => (plain = created)} />
				</>
			),
			mountPoint(),
		);
		expect(owned?.clock).toBe(own);
		expect(plain?.clock).toBe(defaultClock);
	});

	it("runs usePlayer outside a stage on the provided clock", async () => {
		const clock = createClock();
		let player: ReturnType<typeof usePlayer> | undefined;
		function Probe() {
			player = usePlayer();
			return null;
		}
		render(
			() => (
				<ClockProvider clock={clock}>
					<Probe />
				</ClockProvider>
			),
			mountPoint(),
		);
		const x = track(0);
		const run = player?.play({
			duration: 1,
			seek: (time: number) => x.set(time),
		});
		clock.advance(2);
		expect(await run).toBe("done");
		expect(x.peek()).toBe(1);
	});
});

describe("an instances() node as a child", () => {
	it("is placed in JSX order", () => {
		const dots = instances(circle, {
			data: [1, 2, 3],
			channels: { center: (id: number) => ({ x: id, y: 0 }) },
			shared: { radius: 0.2 },
		});
		let scene: Scene | undefined;
		render(
			() => <Stage ref={(created) => (scene = created)}>{dots}</Stage>,
			mountPoint(),
		);
		expect(scene?.root.children).toEqual([dots]);
		expect(dots.count).toBe(3);
	});
});

describe("<OrbitControls3D>", () => {
	it("attaches to the pointer driver and hands out the controller", () => {
		const eye = track({ x: 6, y: 4, z: 8 });
		let controller: OrbitControls3DController | undefined;
		let scene: Scene | undefined;
		const dispose = render(
			() => (
				<Stage ref={(created) => (scene = created)}>
					<OrbitControls3D eye={eye} ref={(made) => (controller = made)} />
				</Stage>
			),
			mountPoint(),
		);
		expect(pointerDriver(scene as Scene)).not.toBeNull();
		expect(typeof controller?.reset).toBe("function");
		dispose();
	});
});
