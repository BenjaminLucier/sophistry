import { Title } from "@solidjs/meta";
import { DemoFrame } from "../components/demo-frame";
import { MorphDemo } from "../demos/morph";

export default function MorphPage() {
	return (
		<>
			<Title>Morph — sophistry playground</Title>
			<DemoFrame
				title="Morph"
				blurb="morph() interpolates a polyline track between circle, square and star."
				demo={MorphDemo}
			/>
		</>
	);
}
