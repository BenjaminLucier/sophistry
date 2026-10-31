import { Title } from "@solidjs/meta";
import { DemoFrame } from "../components/demo-frame";
import { ShapesDemo } from "../demos/shapes";

export default function ShapesPage() {
	return (
		<>
			<Title>Shapes and tweens — sophistry playground</Title>
			<DemoFrame
				title="Shapes and tweens"
				blurb="A circle drawn with draw(), then a dot orbiting it with moveTo()."
				demo={ShapesDemo}
			/>
		</>
	);
}
