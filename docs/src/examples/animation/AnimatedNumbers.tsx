import { hold, parallel, sequence, track, valueTo } from "@sophistry/core";
import {
	DecimalNumber,
	Integer,
	Label,
	Stage,
	usePlayer,
	Variable,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Animated numbers",
	description:
		"An Integer, a DecimalNumber and a Variable count up and back down with valueTo; digits keep fixed-width columns so nothing jitters.",
};

export default function AnimatedNumbers() {
	const { play, signal } = usePlayer();
	const count = track(0);
	const speed = track(0);
	const price = track(0);

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				await play(
					sequence(
						parallel(
							valueTo(count, 12345, { duration: 2 }),
							valueTo(speed, 98.6, { duration: 2 }),
							valueTo(price, 9.5, { duration: 2 }),
						),
						hold(1),
						parallel(
							valueTo(count, 0, { duration: 1.5 }),
							valueTo(speed, 0, { duration: 1.5 }),
							valueTo(price, 0, { duration: 1.5 }),
						),
						hold(0.6),
					),
				);
			}
		})();
	});

	return (
		<Stage units={10}>
			<Label text="Integer" x={-4.5} y={1.6} align="left" fontSize={0.4} />
			<Integer
				value={count}
				x={4.5}
				y={1.6}
				align="right"
				fontSize={0.8}
				groupDigits
				minIntegerDigits={6}
			/>
			<Label text="DecimalNumber" x={-4.5} y={0} align="left" fontSize={0.4} />
			<DecimalNumber
				value={speed}
				x={4.5}
				y={0}
				align="right"
				fontSize={0.8}
				decimalPlaces={1}
				unit=" m/s"
				minIntegerDigits={2}
			/>
			<Label text="Variable" x={-4.5} y={-1.6} align="left" fontSize={0.4} />
			<Variable label="price" value={price} x={-0.5} y={-1.6} fontSize={0.8} />
		</Stage>
	);
}
