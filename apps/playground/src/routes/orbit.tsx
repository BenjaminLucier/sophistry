import { Title } from "@solidjs/meta";
import { DemoFrame } from "../components/demo-frame";
import { OrbitDemo } from "../demos/orbit";

export default function OrbitPage() {
	return (
		<>
			<Title>3D orbit — sophistry playground</Title>
			<DemoFrame
				title="3D orbit"
				blurb="A Camera3D with OrbitControls3D — drag to spin the scene."
				demo={OrbitDemo}
			/>
		</>
	);
}
