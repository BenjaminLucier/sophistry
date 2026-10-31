import { Title } from "@solidjs/meta";
import { DemoFrame } from "../components/demo-frame";
import { LinePlotDemo } from "../demos/line-plot";

export default function LinePlotPage() {
	return (
		<>
			<Title>Line plot — sophistry playground</Title>
			<DemoFrame
				title="Line plot"
				blurb="LinePlot inside Axes: literal data drawn in data coordinates."
				demo={LinePlotDemo}
			/>
		</>
	);
}
