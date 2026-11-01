import { derive, draggable, scalarParam, track } from "@sophistry/core";
import {
	Axes,
	Dot,
	FunctionGraph,
	Label,
	Line,
	Stage,
	useTheme,
} from "@sophistry/solidjs";

export const meta = {
	title: "A slider that drives a graph",
	description:
		"Drag the knob along a line to change the frequency of a sine wave. scalarParam turns the pointer position into a number, and the graph reads that number.",
};

export default function ParameterSlider() {
	const theme = useTheme();
	const palette = () => theme().palette;
	const frequency = track(1);
	const from = { x: -2, y: -1.9 };
	const to = { x: 2, y: -1.9 };
	const param = scalarParam(from, to, { range: [0.5, 3], step: 0.1 });
	const knob = derive(frequency, (value) => ({
		x: from.x + ((value - 0.5) / 2.5) * 4,
		y: from.y,
	}));
	const wave = derive(frequency, (value) => (x: number) => Math.sin(value * x));

	return (
		<Stage units={10}>
			<Axes
				xRange={[-8, 8, 4]}
				yRange={[-1, 1, 1]}
				width={9}
				height={2.8}
				center={{ x: 0, y: 0.5 }}
			>
				<FunctionGraph function={wave} stroke={palette().series[0]} />
			</Axes>
			<Line from={from} to={to} stroke={palette().muted} />
			<Dot
				center={knob}
				radius={0.2}
				label="frequency"
				{...draggable(frequency, { param })}
			/>
			<Label
				text="frequency"
				x={-3.6}
				y={from.y}
				fontSize={0.4}
				color={palette().muted}
			/>
			<Label
				text={derive(frequency, (value) => value.toFixed(1))}
				x={3.2}
				y={from.y}
				fontSize={0.4}
			/>
			<Label
				text="drag the knob"
				y={-2.45}
				color={palette().muted}
				fontSize={0.26}
			/>
		</Stage>
	);
}
