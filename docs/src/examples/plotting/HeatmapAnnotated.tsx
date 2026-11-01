import { Stage } from "@sophistry/solidjs";
import { Heatmap } from "@sophistry/solidjs/charts";

export const meta = {
	title: "Annotated heatmap",
	description:
		"Categorical rows and columns, a colormap, and each value written in a colour that reads on its cell.",
};

const days = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const hours = ["8am", "12pm", "4pm", "8pm"];
const visits = days.flatMap((day, i) =>
	hours.map((hour, j) => ({
		day,
		hour,
		n: Math.round(
			20 + 60 * Math.sin((i + 1) * 0.7 + j) ** 2 + (i > 4 ? 25 : 0),
		),
	})),
);

export default function HeatmapAnnotated() {
	return (
		<Stage units={12}>
			<Heatmap
				data={visits}
				x="day"
				y="hour"
				value="n"
				ramp="viridis"
				width={9}
				height={4}
				title="Visits per hour"
				tooltip
			/>
		</Stage>
	);
}
