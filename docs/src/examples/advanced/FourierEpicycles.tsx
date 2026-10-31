import { derive, GOLD, hold, track, valueTo } from "@sophistry/core";
import { Circle, Dot, Path, Plot, Stage, usePlayer } from "@sophistry/solidjs";
import { For, onSettled } from "solid-js";

export const meta = {
	title: "Fourier epicycles",
	description:
		"Four circles chained end to end, each spinning at its own rate; the tip of the last arm traces a rounded square.",
	uses: [
		"Stage",
		"Circle",
		"Dot",
		"Path",
		"Plot",
		"track",
		"derive",
		"valueTo",
		"usePlayer",
		"hold",
		"GOLD",
	],
};

// Frequency n spins n times per revolution; radius 2.3 / n^2 shrinks fast.
const TERMS = [1, -3, 5, -7].map((n) => ({ n, r: 2.3 / (n * n) }));

/** Joint positions of the chained arms at angle t, from the origin to the tip. */
function arms(t: number) {
	const joints = [{ x: 0, y: 0 }];
	for (const { n, r } of TERMS) {
		const last = joints[joints.length - 1];
		joints.push({
			x: last.x + r * Math.cos(n * t),
			y: last.y + r * Math.sin(n * t),
		});
	}
	return joints;
}

export default function FourierEpicycles() {
	const { play, signal } = usePlayer();
	const t = track(0);
	const joints = derive(t, arms);
	const tip = derive(joints, (joints) => joints[TERMS.length]);

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				t.set(0);
				await play(valueTo(t, 2 * Math.PI, { duration: 10, easing: "linear" }));
				await play(hold(2));
			}
		})();
	});

	return (
		<Stage units={12}>
			<For each={TERMS}>
				{(term, i) => (
					<Circle
						center={derive(joints, (joints) => joints[i()])}
						radius={Math.abs(term.r)}
						opacity={0.5}
					/>
				)}
			</For>
			<Path points={joints} />
			<Plot
				function={(s) => arms(s)[TERMS.length]}
				from={0}
				to={t}
				samples={300}
				stroke={GOLD}
			/>
			<Dot center={tip} color={GOLD} />
		</Stage>
	);
}
