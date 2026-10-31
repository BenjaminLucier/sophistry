import { derive } from "@sophistry/core";
import {
	Arrow,
	Circle,
	Polygon,
	Rect,
	Stage,
	Star,
	useScene,
} from "@sophistry/solidjs";

export const meta = {
	title: "Shapes gallery",
	description:
		"The basic shapes, each styled with stroke, fill and opacity; colors come from the active theme.",
	uses: [
		"Stage",
		"Circle",
		"Rect",
		"Polygon",
		"Star",
		"Arrow",
		"useScene",
		"derive",
	],
};

function Shapes() {
	const theme = useScene().theme;
	const series = (i: number) => derive(theme, (t) => t.palette.series[i]);

	return (
		<>
			<Circle
				center={{ x: -4.4, y: 0 }}
				radius={0.9}
				stroke={series(0)}
				fill={series(0)}
			/>
			<Rect
				center={{ x: -2.2, y: 0 }}
				width={1.8}
				height={1.4}
				cornerRadius={0.2}
				stroke={series(1)}
				fill={series(1)}
				fillOpacity={0.35}
			/>
			<Polygon sides={6} radius={1} stroke={series(2)} fill={series(2)} />
			<Star
				center={{ x: 2.2, y: 0 }}
				outerRadius={1}
				stroke={series(3)}
				fill={series(3)}
				fillOpacity={0.5}
				strokeWidth={0.08}
			/>
			<Arrow
				from={{ x: 3.6, y: -0.8 }}
				to={{ x: 5.2, y: 0.8 }}
				stroke={series(4)}
				strokeWidth={0.08}
			/>
		</>
	);
}

export default function ShapesGallery() {
	return (
		<Stage units={12}>
			<Shapes />
		</Stage>
	);
}
