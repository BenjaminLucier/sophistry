import { Title } from "@solidjs/meta";
import { DemoFrame } from "../components/demo-frame";
import { CalculusDemo } from "../demos/calculus";

export default function CalculusPage() {
	return (
		<>
			<Title>Calculus on a graph — sophistry playground</Title>
			<DemoFrame
				title="Calculus on a graph"
				blurb="Area under a curve, Riemann rectangles piling up, and a secant walking into a tangent."
				demo={CalculusDemo}
			/>
		</>
	);
}
