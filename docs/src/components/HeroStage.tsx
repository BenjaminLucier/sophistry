/**
 * The landing-page island: the brand's epicycle mark, live.
 *
 * `draw()` draws the curve while a dot rides its tip; then the second
 * circle's radius is animated to zero (the curve relaxes into a plain circle),
 * its spin rate changes, and it grows back into a different rosette, forever.
 * A faint grid and ghost outline keep the stage legible before the trace
 * arrives. With `prefers-reduced-motion` the finished mark is shown and nothing
 * moves.
 */
import {
	catppuccin,
	colorModeReadable,
	derive,
	draw,
	hold,
	track,
	valueTo,
} from "@sophistry/core";
import { measure, pointAtT } from "@sophistry/core/geometry";
import {
	Circle,
	Dot,
	Line,
	Path,
	Stage,
	usePlayer,
	useScene,
} from "@sophistry/solidjs";
import { For, onSettled } from "solid-js";

const SCALE = 1.25;
const SAMPLES = 360;
const TAU = Math.PI * 2;
const SPINS = [-4, 3, -2, 5, -4];
const AMPLITUDE = 0.55;

/** The mark's curve: a unit circle carrying a smaller one spinning `k` times. */
function curve(t: number, amp: number, k: number) {
	return {
		x: SCALE * (Math.cos(t) + amp * Math.cos(k * t)),
		y: SCALE * (Math.sin(t) + amp * Math.sin(k * t)),
	};
}

function outline(amp: number, k: number) {
	const pts = [];
	for (let i = 0; i <= SAMPLES; i++)
		pts.push(curve((i / SAMPLES) * TAU, amp, k));
	return pts;
}

const GRID_X = [-4, -3, -2, -1, 0, 1, 2, 3, 4];
const GRID_Y = [-2, -1, 0, 1, 2];

function Mark() {
	const { play, signal } = usePlayer();
	// The brand mauve (the site accent), for whichever mode the page is in.
	const accent = derive(colorModeReadable, (mode) =>
		mode === "light" ? catppuccin.latte.mauve : catppuccin.mocha.mauve,
	);
	// Read once: the hero is a one-shot intro, so a later preference change
	// applies on the next visit rather than re-running the script.
	const reduced = useScene().reducedMotion.peek();

	const drawn = track(reduced ? 1 : 0);
	const amp = track(AMPLITUDE);
	const k = track(SPINS[0] as number);
	const phase = track(0);

	const points = derive([amp, k], outline);
	// While the curve is being drawn it is the first rosette, so the dot can
	// ride its arc length; afterwards it just follows the parameter.
	const firstTable = measure(outline(AMPLITUDE, SPINS[0] as number));
	const tip = derive([drawn, phase, amp, k], (drawn, phase, amp, k) =>
		drawn < 1 ? pointAtT(firstTable, drawn) : curve(phase * TAU, amp, k),
	);

	onSettled(() => {
		if (reduced) return;
		void (async () => {
			await play(draw(drawn, { duration: 3.2 }));
			// The dot keeps circling for as long as the page is open.
			void (async () => {
				while (!signal.aborted) {
					phase.set(0);
					await play(valueTo(phase, 1, { duration: 7, easing: "linear" }));
				}
			})();
			await play(hold(0.8));
			for (let i = 1; !signal.aborted; i = (i + 1) % SPINS.length) {
				await play(valueTo(amp, 0, { duration: 1.6 }));
				k.set(SPINS[i] as number);
				await play(valueTo(amp, AMPLITUDE, { duration: 1.6 }));
				await play(hold(2.4));
			}
		})();
	});

	return (
		<>
			<For each={GRID_X}>
				{(x) => (
					<Line
						from={{ x, y: -2.5 }}
						to={{ x, y: 2.5 }}
						opacity={x === 0 ? 0.18 : 0.08}
					/>
				)}
			</For>
			<For each={GRID_Y}>
				{(y) => (
					<Line
						from={{ x: -4, y }}
						to={{ x: 4, y }}
						opacity={y === 0 ? 0.18 : 0.08}
					/>
				)}
			</For>
			<Path points={points} stroke={accent} opacity={0.22} strokeWidth={0.04} />
			<Path
				points={points}
				stroke={accent}
				progress={drawn}
				strokeWidth={0.09}
			/>
			<Circle center={tip} radius={0.26} stroke={accent} opacity={0.3} />
			<Dot center={tip} radius={0.13} color={accent} />
		</>
	);
}

export function HeroStage() {
	return (
		<Stage units={7} aspect={1.45}>
			<Mark />
		</Stage>
	);
}
