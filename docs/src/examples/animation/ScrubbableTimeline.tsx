import {
	derive,
	draw,
	moveTo,
	scaleTo,
	sequence,
	track,
	trackPoint,
} from "@sophistry/core";
import {
	Circle,
	Text,
	Stage,
	usePlayer,
	useTrackValue,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "A scrubbable timeline",
	description:
		"One script, three steps. player.timeline() runs it and exposes seek, time and playing, so a button and a range slider can pause, resume and scrub it in either direction.",
};

export default function ScrubbableTimeline() {
	const drawn = track(0);
	const position = trackPoint(-3, 0);
	const scale = track(1);

	const tl = usePlayer().timeline(
		sequence(
			draw(drawn, { duration: 1.5 }),
			moveTo(position, { x: 3, y: 0 }, { duration: 2 }),
			scaleTo(scale, 1.8, { duration: 1 }),
		),
	);
	const time = useTrackValue(tl.time);
	const playing = useTrackValue(tl.playing);

	onSettled(() => void tl.play());

	return (
		<div>
			<Stage units={10}>
				<Circle center={position} radius={1} scale={scale} progress={drawn} />
				<Text
					text={derive(tl.time, (t) => `t = ${t.toFixed(2)} s`)}
					y={-2.4}
					fontSize={0.4}
				/>
			</Stage>
			<div
				style={{
					display: "flex",
					gap: "0.75rem",
					"align-items": "center",
					"margin-top": "0.5rem",
				}}
			>
				<button
					type="button"
					style={{ "min-width": "5rem" }}
					onClick={() => (playing() ? tl.pause() : void tl.play())}
				>
					{playing() ? "Pause" : "Play"}
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
