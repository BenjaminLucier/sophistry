import { Title } from "@solidjs/meta";
import { DemoFrame } from "../components/demo-frame";
import { ChartMotionDemo } from "../demos/chart-motion";

export default function ChartMotionPage() {
	return (
		<>
			<Title>Chart motion — sophistry playground</Title>
			<DemoFrame
				title="Chart motion"
				blurb="A clipped chart revealed behind one front while its y domain animates, beside sweeping radar and polar-area charts."
				demo={ChartMotionDemo}
			/>
		</>
	);
}
