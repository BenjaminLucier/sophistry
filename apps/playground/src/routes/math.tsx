import { Title } from "@solidjs/meta";
import { DemoFrame } from "../components/demo-frame";
import { MathDemo } from "../demos/math";

export default function MathPage() {
	return (
		<>
			<Title>LaTeX as geometry — sophistry playground</Title>
			<DemoFrame
				title="LaTeX as geometry"
				blurb="MathTex turns KaTeX output into scene geometry you can animate."
				demo={MathDemo}
			/>
		</>
	);
}
