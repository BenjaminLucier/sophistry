import {
	derive,
	draw,
	fadeIn,
	moveAlong,
	sequence,
	track,
	trackPoint,
} from "@sophistry/core";
import { circlePolyline } from "@sophistry/core/geometry";
import {
	Circle,
	Dot,
	Label,
	Stage,
	usePlayer,
	useTrackValue,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Scrubbable explainer with chapters",
	description:
		"A four-step explainer on one timeline. Chapter buttons sit at offsets computed from each step's duration; the slider and the buttons both just call seek.",
};

const ORBIT = circlePolyline(0, 0, 2);

export default function ScrubChapters() {
	const drawn = track(0);
	const dotOpacity = track(0);
	const dot = trackPoint(2, 0);
	const labelOpacity = track(0);

	const steps = [
		{ title: "1. Draw the orbit", anim: draw(drawn, { duration: 1.5 }) },
		{ title: "2. Place a body", anim: fadeIn(dotOpacity, { duration: 0.8 }) },
		{
			title: "3. Send it around",
			anim: moveAlong(dot, ORBIT, { duration: 3 }),
		},
		{ title: "4. Name it", anim: fadeIn(labelOpacity, { duration: 0.8 }) },
	];

	// Each chapter starts where the previous steps' durations add up.
	let at = 0;
	const chapters = steps.map((step) => {
		const chapter = {
			title: step.title,
			start: at,
			end: at + step.anim.duration,
		};
		at = chapter.end;
		return chapter;
	});

	const tl = usePlayer().timeline(sequence(...steps.map((s) => s.anim)));
	const chapter = derive(
		tl.time,
		(t) => chapters.filter((c) => t >= c.start).pop() ?? chapters[0],
	);
	const time = useTrackValue(tl.time);
	const playing = useTrackValue(tl.playing);
	const current = useTrackValue(chapter);

	onSettled(() => void tl.play());

	return (
		<div>
			<Stage units={10}>
				<Circle radius={2} progress={drawn} />
				<Dot center={dot} radius={0.2} opacity={dotOpacity} />
				<Label text="orbit" x={0} y={0} opacity={labelOpacity} />
				<Label text={derive(chapter, (c) => c.title)} y={-2.5} fontSize={0.4} />
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
				<div style={{ flex: "1", position: "relative" }}>
					<input
						type="range"
						aria-label="Timeline position"
						min={0}
						max={tl.duration}
						step="any"
						value={time()}
						style={{ width: "100%" }}
						onInput={(e) => {
							tl.pause();
							tl.seek(Number(e.currentTarget.value));
						}}
					/>
					<div style={{ position: "relative", height: "1.6rem" }}>
						{chapters.map((c, i) => (
							<button
								type="button"
								title={c.title}
								aria-label={`Jump to ${c.title}`}
								aria-current={current() === c ? "step" : undefined}
								style={{
									position: "absolute",
									left: `${(c.start / tl.duration) * 100}%`,
									"font-size": "0.75rem",
									padding: "0 0.4rem",
									"font-weight": current() === c ? "700" : "400",
								}}
								onClick={() => {
									tl.pause();
									tl.seek(c.start);
								}}
							>
								{i + 1}
							</button>
						))}
					</div>
				</div>
			</div>
		</div>
	);
}
