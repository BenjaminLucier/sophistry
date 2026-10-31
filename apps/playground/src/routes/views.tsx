import { Title } from "@solidjs/meta";
import { DemoFrame } from "../components/demo-frame";
import { ViewsDemo } from "../demos/views";

export default function ViewsPage() {
	return (
		<>
			<Title>Multi-camera views — sophistry playground</Title>
			<DemoFrame
				title="Multi-camera views"
				blurb="One scene through a PictureInPicture inset that tracks a moving dot."
				demo={ViewsDemo}
			/>
		</>
	);
}
