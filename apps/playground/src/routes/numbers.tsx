import { Title } from "@solidjs/meta";
import { DemoFrame } from "../components/demo-frame";
import { NumbersDemo } from "../demos/numbers";

export default function NumbersPage() {
	return (
		<>
			<Title>Animated numbers — sophistry playground</Title>
			<DemoFrame
				title="Animated numbers"
				blurb="Integer and Variable tick via valueTo — columns held open so nothing shimmers."
				demo={NumbersDemo}
			/>
		</>
	);
}
