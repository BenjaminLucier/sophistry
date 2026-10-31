import { Title } from "@solidjs/meta";
import { DemoFrame } from "../components/demo-frame";
import { LatexMorphDemo } from "../demos/latex-morph";

export default function LatexMorphPage() {
	return (
		<>
			<Title>LaTeX morph — sophistry playground</Title>
			<DemoFrame
				title="LaTeX morph"
				blurb="MathTransform carries every shared glyph from one formula to the next."
				demo={LatexMorphDemo}
			/>
		</>
	);
}
