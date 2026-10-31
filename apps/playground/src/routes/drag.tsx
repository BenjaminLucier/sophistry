import { Title } from "@solidjs/meta";
import { DemoFrame } from "../components/demo-frame";
import { DragDemo } from "../demos/drag";

export default function DragPage() {
	return (
		<>
			<Title>Draggable — sophistry playground</Title>
			<DemoFrame
				title="Draggable"
				blurb="Three dots, three constraints: free, pinned to a circle, snapped to a grid."
				demo={DragDemo}
			/>
		</>
	);
}
