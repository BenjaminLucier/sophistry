import {
	type Animation,
	arcMotion,
	colorTo,
	createClock,
	createSlots,
	derive,
	indicate,
	parallel,
	resolveTheme,
	rowSlots,
	type SlotItem,
	sequence,
	timeline,
	track,
} from "@sophistry/core";
import { Label, Rect, Stage, useTrackValue } from "@sophistry/solidjs";
import { For, onSettled } from "solid-js";

export const meta = {
	title: "Scrubbable bubble sort",
	description:
		"A sort recorded as one timeline: bars keep their identity in a slots model, every compare and swap is an animation, so you can play, pause, step and scrub the whole run in either direction.",
};

const VALUES = [5, 2, 7, 3, 8, 1, 6, 4];

export default function ScrubbableSort() {
	// The recorded run bakes in the colours of the page's theme at mount.
	const colors = resolveTheme().palette;
	const clock = createClock();

	// Identity and slots live in the model; each bar's value is its key. Items
	// keep their own tracks (position, scale), so bars never re-mount.
	const slots = createSlots(VALUES, {
		layout: rowSlots({ spacing: 1.25 }),
		motion: arcMotion({ bend: 0.3 }),
		duration: 0.4,
	});
	const items = useTrackValue(slots.items);
	const fills = new Map(VALUES.map((v) => [v, track(colors.series[0])]));
	const scaleOf = (key: number) => (slots.item(key) as SlotItem<number>).scale;

	// Record the whole run up front; the plan tracks the order as we go.
	const plan = slots.plan();
	const steps: Animation[] = [];
	for (let end = VALUES.length - 1; end > 0; end--) {
		for (let i = 0; i < end; i++) {
			const a = plan.order[i] as number;
			const b = plan.order[i + 1] as number;
			const parts: Animation[] = [
				parallel(
					indicate(scaleOf(a), { color: fills.get(a), duration: 0.4 }),
					indicate(scaleOf(b), { color: fills.get(b), duration: 0.4 }),
				),
			];
			if (a > b) parts.push(plan.swapAt(i, i + 1));
			steps.push(sequence(...parts));
		}
		// The largest remaining bar has bubbled into place.
		const done = fills.get(plan.order[end] as number);
		if (done) steps.push(colorTo(done, colors.positive, { duration: 0.25 }));
	}
	const first = fills.get(plan.order[0] as number);
	if (first) steps.push(colorTo(first, colors.positive, { duration: 0.25 }));

	// Where each step ends, for the "step" buttons.
	const ends: number[] = [];
	let t = 0;
	for (const step of steps) {
		t += step.duration;
		ends.push(t);
	}

	const tl = timeline(sequence(...steps), { clock });
	const time = useTrackValue(tl.time);
	const playing = useTrackValue(tl.playing);
	const stepIndex = derive(
		tl.time,
		(time) => ends.filter((end) => end <= time + 1e-6).length,
	);
	const jump = (direction: 1 | -1) => {
		tl.pause();
		const now = tl.time.peek();
		const target =
			direction === 1
				? (ends.find((end) => end > now + 1e-6) ?? tl.duration)
				: ([0, ...ends].filter((end) => end < now - 1e-6).pop() ?? 0);
		tl.seek(target);
	};

	onSettled(() => {
		void tl.play();
		return () => tl.abort();
	});

	return (
		<div>
			<Stage units={12} clock={clock}>
				<For each={items()}>
					{(item) => (
						<Rect
							center={derive(item.position, (position) => ({
								x: position.x,
								// The arc's lift, so swapping bars pass round each other.
								y: position.y - 1.5 + item.key / 4,
							}))}
							width={1}
							height={item.key / 2}
							scale={item.scale}
							fill={fills.get(item.key)}
						/>
					)}
				</For>
				<Label
					text={derive(stepIndex, (index) => `step ${index} / ${steps.length}`)}
					y={2.8}
					fontSize={0.4}
				/>
			</Stage>
			<div
				style={{
					display: "flex",
					gap: "0.5rem",
					"align-items": "center",
					"margin-top": "0.5rem",
				}}
			>
				<button type="button" onClick={() => jump(-1)}>
					Step back
				</button>
				<button
					type="button"
					style={{ "min-width": "5rem" }}
					onClick={() => (tl.playing.peek() ? tl.pause() : void tl.play())}
				>
					{playing() ? "Pause" : "Play"}
				</button>
				<button type="button" onClick={() => jump(1)}>
					Step
				</button>
				<input
					type="range"
					aria-label="Timeline position"
					min={0}
					max={tl.duration}
					step="any"
					value={time()}
					style={{ flex: "1" }}
					onInput={(e) => {
						tl.pause();
						tl.seek(Number(e.currentTarget.value));
					}}
				/>
			</div>
		</div>
	);
}
