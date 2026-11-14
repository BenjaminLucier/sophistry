import "katex/dist/katex.css";
import { render } from "@solidjs/web";
import {
	createClock,
	exportFrames,
	moveTo,
	type Scene,
	timeline,
	track,
	trackPoint,
} from "@sophistry/core";
import { Line, Rect, Stage, Text } from "@sophistry/solidjs";
import { MathTex } from "@sophistry/solidjs/text";
import { createSignal, For, onSettled, Show } from "solid-js";

/**
 * Fixture scenes for the real-browser tests, picked by `?s=<name>`. Each one
 * publishes what its test needs on `window.__t`.
 */
declare global {
	interface Window {
		// biome-ignore lint/suspicious/noExplicitAny: a bag of test hooks
		__t: Record<string, any>;
	}
}
window.__t = {};
const t = window.__t;
const params = new URLSearchParams(location.search);

/** Moves a rect with a clock, bumping a counter per tick. */
function ClockStage(props: {
	id: string;
	pauseWhenHidden?: boolean;
	external?: boolean;
}) {
	const clock = createClock();
	const x = trackPoint(-6, 0);
	let n = 0;
	t.clocks ??= {};
	t.ticks ??= {};
	t.clocks[props.id] = clock;
	t.ticks[props.id] = 0;
	onSettled(() => {
		if (props.external) {
			// Not clock-driven: a plain rAF loop writing the track, so only the
			// stage's own visibility gate can stop its painting.
			let raf = 0;
			const loop = () => {
				n++;
				t.ticks[props.id] = n;
				x.set({ x: -6 + (n % 120) * 0.1, y: 0 });
				raf = requestAnimationFrame(loop);
			};
			raf = requestAnimationFrame(loop);
			return () => cancelAnimationFrame(raf);
		}
		return clock.onTick(() => {
			n++;
			t.ticks[props.id] = n;
			x.set({ x: -6 + (n % 120) * 0.1, y: 0 });
		});
	});
	return (
		<div class="box" data-stage={props.id}>
			<Stage
				units={16}
				clock={props.external ? undefined : clock}
				pauseWhenHidden={props.pauseWhenHidden}
			>
				<Rect center={x} width={1} height={2} fill="#ff0000" />
			</Stage>
		</div>
	);
}

const spacer = (h: number) => <div style={{ height: `${h}px` }} />;

const scenes: Record<string, () => unknown> = {
	/** One clock-driven rect; the test records frame index per tick and per paint. */
	"same-frame": () => {
		const clock = createClock();
		const x = trackPoint(-7, 0);
		let n = 0;
		t.tick = 0;
		t.tickFrame = {} as Record<number, number>;
		onSettled(() =>
			clock.onTick(() => {
				n++;
				t.tick = n;
				t.tickFrame[n] = t.frame;
				x.set({ x: -7 + (n % 140) * 0.1, y: 0 });
			}),
		);
		return (
			<div class="box" data-stage="same">
				<Stage units={16} clock={clock}>
					<Rect center={x} width={0.6} height={2} fill="#ff0000" />
				</Stage>
			</div>
		);
	},

	/**
	 * Frame export: a red rect slides from x = -6 to x = 6 over one second.
	 * `__t.run(fps)` exports the timeline and reports, per frame, where the
	 * rect's pixels are found in the *encoded image* next to where they belong.
	 */
	export: () => {
		const clock = createClock();
		const x = trackPoint(-6, 0);
		const tl = timeline(
			moveTo(x, { x: 6, y: 0 }, { duration: 1, easing: "linear" }),
			{
				clock,
			},
		);
		let canvas: HTMLCanvasElement | undefined;
		t.tl = tl;
		t.x = x;
		t.run = async (fps: number) => {
			if (!canvas) throw new Error("no canvas");
			const frames = await exportFrames({ timeline: tl, canvas, fps, clock });
			const out = [];
			for (const frame of frames) {
				const bitmap = await createImageBitmap(frame.blob);
				const scratch = document.createElement("canvas");
				scratch.width = bitmap.width;
				scratch.height = bitmap.height;
				const ctx = scratch.getContext("2d") as CanvasRenderingContext2D;
				ctx.drawImage(bitmap, 0, 0);
				const row = ctx.getImageData(
					0,
					Math.round(bitmap.height / 2),
					bitmap.width,
					1,
				).data;
				let min = -1;
				let max = -1;
				for (let i = 0; i < bitmap.width; i++) {
					const r = row[i * 4] as number;
					const g = row[i * 4 + 1] as number;
					if (r > 200 && g < 60) {
						if (min < 0) min = i;
						max = i;
					}
				}
				out.push({
					index: frame.index,
					time: frame.time,
					type: frame.blob.type,
					center: min < 0 ? null : (min + max) / 2,
					expected:
						bitmap.width / 2 + (-6 + 12 * frame.time) * (bitmap.width / 16),
				});
			}
			return out;
		};
		return (
			<div class="box" data-stage="export">
				<Stage
					units={16}
					clock={clock}
					ref={(scene: Scene) => {
						canvas = scene.canvas ?? undefined;
					}}
				>
					<Rect center={x} width={1} height={2} fill="#ff0000" />
				</Stage>
			</div>
		);
	},

	offscreen: () => (
		<>
			<ClockStage id="A" />
			{spacer(3000)}
			<ClockStage id="B" external />
			{spacer(3000)}
			<ClockStage id="D" pauseWhenHidden={false} />
			{spacer(3000)}
			<div
				data-scroller
				style={{ height: "300px", width: "420px", overflow: "auto" }}
			>
				{spacer(1500)}
				<ClockStage id="C" />
				{spacer(50)}
			</div>
			{spacer(3000)}
		</>
	),

	order: () => {
		const [show, setShow] = createSignal(false);
		const [order, setOrder] = createSignal(["r", "g", "b"]);
		t.setShow = setShow;
		t.setOrder = setOrder;
		const fills: Record<string, string> = {
			r: "#ff0000",
			g: "#00ff00",
			b: "#0000ff",
		};
		const offset: Record<string, number> = { r: -0.5, g: 0, b: 0.5 };
		return (
			<>
				<div class="box" data-stage="show">
					<Stage units={16}>
						<Show when={show()}>
							<Rect
								center={{ x: -0.5, y: 0 }}
								width={4}
								height={4}
								fill="#ff0000"
							/>
						</Show>
						<Rect
							center={{ x: 0.5, y: 0 }}
							width={4}
							height={4}
							fill="#0000ff"
						/>
					</Stage>
				</div>
				<div class="box" data-stage="for">
					<Stage units={16}>
						<For each={order()}>
							{(k) => (
								<Rect
									center={{ x: offset[k], y: 0 }}
									width={4}
									height={4}
									fill={fills[k]}
								/>
							)}
						</For>
					</Stage>
				</div>
			</>
		);
	},

	text: () => {
		const units = Number(params.get("units") ?? 8);
		const yUp = params.get("yUp") !== "0";
		return (
			<div class="box" data-stage="text">
				<Stage units={units} yUp={yUp}>
					<Text text="T" fontSize={4} fontWeight={700} color="#000000" />
				</Stage>
			</div>
		);
	},

	stroke: () => {
		const units = Number(params.get("units") ?? 8);
		return (
			<div class="box" data-stage="stroke">
				<Stage units={units}>
					<Line
						from={{ x: -2, y: 0 }}
						to={{ x: 2, y: 0 }}
						stroke="#000000"
						strokeWidth={0.5}
					/>
				</Stage>
			</div>
		);
	},

	hover: () => {
		const cx = trackPoint(0, 0);
		const hovered = track(false);
		t.setCenter = (x: number) => cx.set({ x, y: 0 });
		t.hovered = hovered;
		return (
			<div class="box" data-stage="hover">
				<Stage
					units={16}
					center={cx}
					ref={(scene: Scene) => {
						t.pointer = scene.pointer;
					}}
				>
					<Rect
						center={{ x: 3, y: 0 }}
						width={2}
						height={4}
						fill="#ff0000"
						hover={hovered}
						onPointerDown={() => {}}
					/>
				</Stage>
			</div>
		);
	},
	/** A real (unmocked) typeset formula in solid red, fully drawn. */
	math: () => {
		t.typeset = false;
		return (
			<div class="box" data-stage="math">
				<Stage units={10}>
					<MathTex
						tex="e^{i\pi} + 1 = 0"
						fontSize={1.2}
						fill="#ff0000"
						stroke="#ff0000"
						onTypeset={() => {
							t.typeset = true;
						}}
					/>
				</Stage>
			</div>
		);
	},
};

const root = document.getElementById("root");
const make = scenes[params.get("s") ?? ""];
if (!root || !make) throw new Error(`unknown scene ${params.get("s")}`);
render(() => <>{make()}</>, root);
