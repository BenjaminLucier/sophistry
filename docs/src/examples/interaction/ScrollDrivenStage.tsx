import {
	createClock,
	derive,
	draw,
	moveTo,
	sequence,
	timeline,
	track,
	trackPoint,
} from "@sophistry/core";
import { Circle, Text, Line, Stage } from "@sophistry/solidjs";
import { onCleanup } from "solid-js";

export const meta = {
	title: "Scroll-driven animation",
	description:
		"Scroll the box: its scroll position is the timeline's time. A sticky stage stays pinned while the page behind it moves, and scrolling back rewinds the scene.",
};

export default function ScrollDrivenStage() {
	const clock = createClock();
	const drawn = track(0);
	const pos = trackPoint(-3, 0);
	const progress = track(0);

	const tl = timeline(
		sequence(
			draw(drawn, { duration: 1 }),
			moveTo(pos, { x: 3, y: 0 }, { duration: 2 }),
			moveTo(pos, { x: 0, y: 0 }, { duration: 1 }),
		),
		{ clock },
	);
	onCleanup(() => tl.dispose());
	const readout = derive(
		[progress, tl.time],
		(p, time) => `scroll ${Math.round(p * 100)}%  ·  t = ${time.toFixed(2)} s`,
	);

	// Scroll position (0..1) maps straight onto timeline time.
	const onScroll = (el: HTMLElement) => {
		const range = el.scrollHeight - el.clientHeight;
		const p = range > 0 ? el.scrollTop / range : 0;
		progress.set(p);
		tl.seek(p * tl.duration);
	};

	return (
		<section
			aria-label="Scrollable demo: scroll to advance the animation"
			tabindex={0}
			style={{
				height: "20rem",
				"overflow-y": "auto",
				border: "1px solid rgba(127,127,127,0.4)",
				"border-radius": "0.5rem",
			}}
			onScroll={(e) => onScroll(e.currentTarget)}
		>
			<div style={{ height: "60rem", position: "relative" }}>
				<div style={{ position: "sticky", top: "0" }}>
					<Stage units={10} clock={clock} aspect={2.2}>
						{/* A faint guide, so the stage reads before the first scroll. */}
						<Line from={{ x: -3, y: 0 }} to={{ x: 3, y: 0 }} opacity={0.25} />
						<Circle center={{ x: -3, y: 0 }} radius={1} opacity={0.25} />
						<Circle center={{ x: 3, y: 0 }} radius={1} opacity={0.25} />
						<Circle center={pos} radius={1} progress={drawn} />
						<Text text={readout} y={-1.9} fontSize={0.35} />
					</Stage>
				</div>
			</div>
		</section>
	);
}
