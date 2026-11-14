import { derive, draggable, trackPoint } from "@sophistry/core";
import { Dot, Polygon, Stage, Text, useTheme } from "@sophistry/solidjs";

export const meta = {
	title: "Linked dots",
	description:
		"Drag any corner of the triangle. The outline and the area readout are derived from the three dragged points, so they update on every move.",
};

export default function LinkedDots() {
	const theme = useTheme();
	const palette = () => theme().palette;
	const corners = [trackPoint(-2, -1), trackPoint(2, -1), trackPoint(0, 1.5)];
	const handles = corners.map((corner) => draggable(corner));

	const points = derive(corners, (a, b, c) => [a, b, c]);
	const area = derive(
		corners,
		(a, b, c) =>
			Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2,
	);

	return (
		<Stage units={10}>
			<Polygon points={points} fill={palette().series[0]} fillOpacity={0.3} />
			{corners.map((corner, i) => (
				<Dot
					center={corner}
					radius={0.2}
					label={`corner ${i + 1}`}
					{...handles[i]}
				/>
			))}
			<Text
				text={derive(area, (value) => `area = ${value.toFixed(2)}`)}
				y={-1.9}
			/>
			<Text
				text="drag the corners"
				y={-2.45}
				color={palette().muted}
				fontSize={0.26}
			/>
		</Stage>
	);
}
