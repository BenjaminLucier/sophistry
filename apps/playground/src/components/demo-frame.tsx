import { defaultClock } from "@sophistry/core";
import { useTrackValue } from "@sophistry/solidjs";
import type { Component } from "solid-js";
import { createSignal, For } from "solid-js";

const SPEEDS = [0.25, 0.5, 1, 2] as const;

const button =
	"rounded-md border border-rule px-3 py-1 text-sm hover:bg-surface";

/**
 * `DemoFrame` for the `@sophistry` demos: the same box and playback
 * controls, driving core's `defaultClock` (whose `paused` and `speed` are
 * Readables, read here through `useTrackValue`). Replay remounts the demo.
 */
export function DemoFrame(props: {
	title: string;
	blurb: string;
	demo: Component;
}) {
	const [run, setRun] = createSignal(0);
	const paused = useTrackValue(defaultClock.paused);
	const speed = useTrackValue(defaultClock.speed);

	return (
		<section class="rounded-xl border border-rule p-4">
			<header class="mb-3 flex flex-wrap items-baseline justify-between gap-2">
				<div>
					<h2 class="text-lg font-semibold">{props.title}</h2>
					<p class="text-sm text-muted">{props.blurb}</p>
				</div>
				<div class="flex flex-wrap items-center gap-2">
					<button
						type="button"
						class={button}
						onClick={() => defaultClock.toggle()}
					>
						{paused() ? "Resume" : "Pause"}
					</button>
					<For each={[...SPEEDS]}>
						{(value) => (
							<button
								type="button"
								class={[button, { "bg-surface": speed() === value }]}
								onClick={() => defaultClock.setSpeed(value)}
							>
								{value}×
							</button>
						)}
					</For>
					<button
						type="button"
						class={button}
						onClick={() => setRun((n) => n + 1)}
					>
						Replay
					</button>
				</div>
			</header>
			{/* A fresh array each run changes identity, which remounts the demo. */}
			<For each={[run()]}>{() => <props.demo />}</For>
		</section>
	);
}
