import {
	derive,
	draw,
	sequence,
	type Track,
	track,
	valueTo,
} from "@sophistry/core";
import {
	Arc,
	Circle,
	Dot,
	Label,
	Line,
	Stage,
	usePlayer,
	useScene,
	useTrackValue,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "First scene: scrub it with a timeline",
	description:
		"Step four of the first-scene tutorial: the whole script becomes a timeline you can seek with a slider, backwards as well as forwards.",
	uses: [
		"Stage",
		"Circle",
		"Line",
		"Arc",
		"Dot",
		"Label",
		"track",
		"derive",
		"draw",
		"valueTo",
		"sequence",
		"usePlayer",
		"useScene",
		"useTrackValue",
	],
};

const RADIUS = 2.4;

/** The ring, radius and angle, coloured from the stage's theme. */
function Ring(props: { drawn: Track<number>; theta: Track<number> }) {
	const palette = derive(useScene().theme, (t) => t.palette);
	const tip = derive(props.theta, (theta) => ({
		x: RADIUS * Math.cos(theta),
		y: RADIUS * Math.sin(theta),
	}));
	return (
		<>
			<Circle
				radius={RADIUS}
				stroke={derive(palette, (p) => p.grid)}
				progress={props.drawn}
			/>
			<Line
				from={{ x: 0, y: 0 }}
				to={tip}
				stroke={derive(palette, (p) => p.series[0])}
			/>
			<Arc
				radius={0.8}
				angle={props.theta}
				stroke={derive(palette, (p) => p.series[1])}
			/>
			<Dot center={tip} />
		</>
	);
}

export default function FirstSceneTimeline() {
	const drawn = track(0);
	const theta = track(0);
	const tl = usePlayer().timeline(
		sequence(
			draw(drawn, { duration: 1.2 }),
			valueTo(theta, 2 * Math.PI, { duration: 3, easing: "smooth" }),
		),
	);
	const time = useTrackValue(tl.time);
	const playing = useTrackValue(tl.playing);
	onSettled(() => void tl.play());

	return (
		<>
			<Stage units={10} aspect={4 / 3}>
				<Ring drawn={drawn} theta={theta} />
				<Label text={derive(tl.time, (t) => `t = ${t.toFixed(1)} s`)} y={-3} />
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
					onClick={() => (playing() ? tl.pause() : void tl.play())}
				>
					{playing() ? "Pause" : "Play"}
				</button>
				<input
					type="range"
					aria-label="Timeline position"
					style={{ flex: "1" }}
					min={0}
					max={tl.duration}
					step="any"
					value={time()}
					onInput={(e) => {
						tl.pause();
						tl.seek(Number(e.currentTarget.value));
					}}
				/>
			</div>
		</>
	);
}
