import {
	derive,
	draw,
	moveTo,
	sequence,
	track,
	trackPoint,
} from "@sophistry/core";
import {
	Circle,
	Dot,
	Stage,
	Text,
	usePlayer,
	useTrackValue,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export default function ScrubDemo() {
	const drawn = track(0);
	const dot = trackPoint(2, 0);

	// One animation value, one seekable controller.
	const tl = usePlayer().timeline(
		sequence(
			draw(drawn, { duration: 2 }),
			moveTo(dot, { x: 0, y: 2 }, { duration: 1 }),
		),
	);
	const time = useTrackValue(tl.time);
	onSettled(() => void tl.play());

	return (
		<div class="scrub-demo">
			<Stage units={8}>
				<Circle center={{ x: 0, y: 0 }} radius={2} progress={drawn} />
				<Dot center={dot} />
				<Text text={derive(tl.time, (t) => `t = ${t.toFixed(2)} s`)} y={-2.6} />
			</Stage>
			<input
				type="range"
				aria-label="Scrub the timeline"
				min={0}
				max={tl.duration}
				step={0.01}
				value={time()}
				onInput={(e) => {
					tl.pause();
					tl.seek(Number(e.currentTarget.value));
				}}
			/>
		</div>
	);
}
