import type { Clock } from "@sophistry/core";
import { circle, createScene, instances, label } from "@sophistry/core";

export const meta = {
	title: "Instancing: thousands of dots, one node",
	description:
		"instances() draws 4,000 circles as one node with per-item channels; changing its data tweens every dot to a new layout with a stagger.",
};

interface Item {
	id: number;
	x: number;
	y: number;
}

const COUNT = 4000;
const COLORS = ["#89b4fa", "#a6e3a1", "#f9e2af", "#f38ba8"];

/** A spiral (sunflower) layout, or a grid. */
function layout(spiral: boolean): Item[] {
	return Array.from({ length: COUNT }, (_, id) => {
		if (!spiral)
			return {
				id,
				x: ((id % 80) - 39.5) * 0.18,
				y: (Math.floor(id / 80) - 24.5) * 0.18,
			};
		const radius = 0.07 * Math.sqrt(id);
		const angle = id * 2.39996;
		return { id, x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
	});
}

export default function mount(host: HTMLElement, clock?: Clock): () => void {
	const scene = createScene({ host, clock, units: 16 });
	const dots = instances(circle, {
		data: layout(true),
		key: (item) => item.id,
		channels: { center: (item) => item, fill: (item) => COLORS[item.id % 4] },
		shared: { radius: 0.06, stroke: "none" },
		transition: {
			duration: 1.2,
			stagger: 0.0002,
			enter: { from: { opacity: 0 } },
		},
	});
	scene.add(dots);
	scene.add(
		label.create({
			text: "4,000 dots, one node: click to re-lay them",
			y: -4.1,
		}),
	);
	let spiral = true;
	const toggle = () => {
		spiral = !spiral;
		dots.set("data", layout(spiral));
	};
	host.addEventListener("click", toggle);
	return () => {
		host.removeEventListener("click", toggle);
		scene.dispose();
	};
}
