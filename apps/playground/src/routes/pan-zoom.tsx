import { Title } from "@solidjs/meta";
import { DemoFrame } from "../components/demo-frame";
import { PanZoomDemo } from "../demos/pan-zoom";

export default function PanZoomPage() {
	return (
		<>
			<Title>Pan &amp; zoom — sophistry playground</Title>
			<DemoFrame
				title="Pan &amp; zoom"
				blurb="Wheel to zoom (pinned to the cursor), drag to pan — the camera cells are ordinary tracks."
				demo={PanZoomDemo}
			/>
		</>
	);
}
