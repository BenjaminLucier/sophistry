import { draw, track } from "@sophistry/core";
import { Stage, usePlayer } from "@sophistry/solidjs";
import { Funnel } from "@sophistry/solidjs/charts";
import { onSettled } from "solid-js";

export const meta = {
	title: "Funnel",
	description:
		"Stages of a process, top-down: each widens out from the centre, the loss between them shaded.",
	uses: ["Stage", "Funnel", "track", "draw", "usePlayer"],
};

const signups = [
	{ step: "Visited", n: 12000 },
	{ step: "Signed up", n: 4800 },
	{ step: "Activated", n: 2600 },
	{ step: "Subscribed", n: 900 },
];

export default function FunnelStages() {
	const { play } = usePlayer();
	const shown = track(0);

	onSettled(() => {
		void play(draw(shown, { duration: 2.5 }));
	});

	return (
		<Stage units={12}>
			<Funnel
				data={signups}
				value="n"
				label="step"
				width={7}
				height={4.5}
				center={{ x: 0.8, y: 0 }}
				progress={shown}
				tooltip
			/>
		</Stage>
	);
}
