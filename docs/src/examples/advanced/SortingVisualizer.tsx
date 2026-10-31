import {
	arcMotion,
	createSlots,
	derive,
	GOLD,
	hold,
	rowSlots,
	track,
} from "@sophistry/core";
import {
	Label,
	Rect,
	Stage,
	usePlayer,
	useTrackValue,
} from "@sophistry/solidjs";
import { For, onSettled } from "solid-js";

export const meta = {
	title: "Sorting visualizer",
	description:
		"Bars bubble-sort themselves: a slots model keeps each bar's identity, each swap is one plan.swapAt() played with an await, and the compared pair is highlighted.",
	uses: [
		"Stage",
		"Rect",
		"Label",
		"createSlots",
		"rowSlots",
		"arcMotion",
		"track",
		"derive",
		"useTrackValue",
		"GOLD",
		"usePlayer",
		"hold",
	],
};

const VALUES = [5, 2, 7, 3, 8, 1, 6, 4];

export default function SortingVisualizer() {
	const { play, signal } = usePlayer();
	// Keys are the bar values; the model owns which bar is in which slot.
	const slots = createSlots(VALUES, {
		layout: rowSlots({ spacing: 1.2 }),
		motion: arcMotion({ bend: 0.3 }),
		duration: 0.35,
	});
	const items = useTrackValue(slots.items);
	const active = track<number[]>([]);

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				// Each `plan()` starts from the order the last play left.
				for (let end = VALUES.length - 1; end > 0; end--) {
					for (let i = 0; i < end; i++) {
						const order = slots.order.peek();
						const [a, b] = [order[i], order[i + 1]] as [number, number];
						active.set([a, b]);
						await play(hold(0.2));
						if (a > b) await play(slots.plan().swapAt(i, i + 1));
					}
				}
				active.set([]);
				await play(hold(1.5));
				await play(slots.plan().permute(VALUES, { lag: 0.05 }));
				await play(hold(0.5));
			}
		})();
	});

	return (
		<Stage units={12}>
			<For each={items()}>
				{(item) => {
					const lit = derive(active, (active) => active.includes(item.key));
					return (
						<Rect
							center={derive(item.position, (position) => ({
								x: position.x,
								// The arc's lift, so swapping bars pass round each other.
								y: position.y - 2.5 + item.key / 4,
							}))}
							width={1}
							height={item.key / 2}
							opacity={derive(lit, (lit) => (lit ? 1 : 0.55))}
							fill={derive(lit, (lit) => (lit ? GOLD : undefined))}
						/>
					);
				}}
			</For>
			<Label text="bubble sort" y={2.8} />
		</Stage>
	);
}
