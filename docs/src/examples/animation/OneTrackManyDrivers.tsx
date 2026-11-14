import {
	derive,
	draggable,
	scalarParam,
	type Track,
	track,
	valueTo,
} from "@sophistry/core";
import {
	Dot,
	Line,
	Stage,
	Text,
	usePlayer,
	useScene,
	useTrackValue,
} from "@sophistry/solidjs";

export const meta = {
	title: "One track, many drivers",
	description:
		"The same x track is written by dragging the knob, by a tween from the button, and by a slider. Nothing is wired together: they all just write the track.",
};

const FROM = { x: -3, y: 0 };
const TO = { x: 3, y: 0 };

function Knob(props: { x: Track<number> }) {
	const palette = derive(useScene().theme, (t) => t.palette);
	const param = scalarParam(FROM, TO, { range: [-3, 3] });
	return (
		<>
			<Line from={FROM} to={TO} stroke={derive(palette, (p) => p.grid)} />
			<Dot
				center={derive(props.x, (x) => ({ x, y: 0 }))}
				radius={0.22}
				label="value"
				{...draggable(props.x, { param })}
			/>
			<Text text={derive(props.x, (x) => `x = ${x.toFixed(2)}`)} y={1.2} />
			<Text
				text="drag it, tween it, or slide it"
				y={-1.2}
				fontSize={0.28}
				color={derive(palette, (p) => p.muted)}
			/>
		</>
	);
}

export default function OneTrackManyDrivers() {
	const { play } = usePlayer();
	const x = track(0);
	const value = useTrackValue(x);

	return (
		<>
			<Stage units={10}>
				<Knob x={x} />
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
					onClick={() => void play(valueTo(x, x.peek() > 0 ? -3 : 3))}
				>
					Tween to the other end
				</button>
				<input
					type="range"
					aria-label="x"
					style={{ flex: "1" }}
					min={-3}
					max={3}
					step="any"
					value={value()}
					onInput={(e) => x.set(Number(e.currentTarget.value))}
				/>
			</div>
		</>
	);
}
