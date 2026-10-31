import { Title } from "@solidjs/meta";
import { DemoFrame } from "../components/demo-frame";
import { BarsDemo } from "../demos/bars";

export default function BarsPage() {
	return (
		<>
			<Title>Bar chart — sophistry playground</Title>
			<DemoFrame
				title="Bar chart"
				blurb="A BarChart from sophistry/charts revealed with a progress track."
				demo={BarsDemo}
			/>
		</>
	);
}
