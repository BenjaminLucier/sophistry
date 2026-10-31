import { Title } from "@solidjs/meta";
import { DemoFrame } from "../components/demo-frame";
import { LinearDemo } from "../demos/linear";

export default function LinearPage() {
	return (
		<>
			<Title>Linear transform — sophistry playground</Title>
			<DemoFrame
				title="Linear transform"
				blurb="A shear warps the grid, a dot rides along, and the basis arrows report the map."
				demo={LinearDemo}
			/>
		</>
	);
}
