import { Title } from "@solidjs/meta";
import { DemoFrame } from "../components/demo-frame";
import { PieDemo } from "../demos/pie";

export default function PiePage() {
	return (
		<>
			<Title>Pie chart — sophistry playground</Title>
			<DemoFrame
				title="Pie chart"
				blurb="PieChart with per-slice labels, revealed as one shape."
				demo={PieDemo}
			/>
		</>
	);
}
