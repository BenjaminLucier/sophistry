import {
	applyComplexFunction,
	derive,
	hold,
	sequence,
	track,
} from "@sophistry/core";
import type { Polyline } from "@sophistry/core/geometry";
import { Line, Path, Stage, usePlayer, useScene } from "@sophistry/solidjs";
import { onSettled } from "solid-js";

export const meta = {
	title: "Squaring the complex plane",
	description:
		"A grid of lines is sent through z ↦ z²: straight lines bend into parabolas, and right angles stay right angles.",
};

/** Horizontal and vertical lines over 0.3 ≤ x ≤ 1.5, −0.6 ≤ y ≤ 0.6. */
function grid(): Polyline[] {
	const lines: Polyline[] = [];
	for (let i = 0; i <= 6; i++) {
		const y = -0.6 + i * 0.2;
		lines.push([
			{ x: 0.3, y },
			{ x: 1.5, y },
		]);
		const x = 0.3 + i * 0.2;
		lines.push([
			{ x, y: -0.6 },
			{ x, y: 0.6 },
		]);
	}
	return lines;
}

const square = ({ re, im }: { re: number; im: number }) => ({
	re: re * re - im * im,
	im: 2 * re * im,
});

function Squaring() {
	const accent = derive(useScene().theme, (theme) => theme.palette.accent);
	const { play, signal } = usePlayer();
	const lines = track(grid());

	onSettled(() => {
		void (async () => {
			while (!signal.aborted) {
				lines.set(grid());
				await play(
					sequence(
						hold(0.6),
						applyComplexFunction(lines, square, { duration: 2.5 }),
						hold(1.2),
					),
				);
			}
		})();
	});

	return (
		<>
			<Line from={{ x: -1, y: 0 }} to={{ x: 3, y: 0 }} opacity={0.35} />
			<Line from={{ x: 0, y: -2 }} to={{ x: 0, y: 2 }} opacity={0.35} />
			<Path points={lines} stroke={accent} strokeWidth={0.015} />
		</>
	);
}

export default function ComplexSquaring() {
	return (
		<Stage units={7.6} center={{ x: 1, y: 0 }}>
			<Squaring />
		</Stage>
	);
}
