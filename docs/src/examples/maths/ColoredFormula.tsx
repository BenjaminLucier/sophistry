import { derive, draw, track, writePhase } from "@sophistry/core";
import {
	Path,
	Stage,
	usePlayer,
	useScene,
	useTrackValue,
} from "@sophistry/solidjs";
import { createLatex, OUTLINE_RATIO } from "@sophistry/text";
import { For, onCleanup, onSettled } from "solid-js";

export const meta = {
	title: "Coloring parts of a formula",
	description:
		"createLatex hands back every glyph as its own part, so each one can get its own color. Here the unknown x is picked out from the rest of the equation.",
};

const fontSize = 0.9;

function Formula() {
	const { play } = usePlayer();
	const theme = useScene().theme;
	const progress = track(0);
	const latex = createLatex("3x^2 + 2x - x = 4x^2 - 5", { fontSize });
	onCleanup(() => latex.dispose());
	// Which glyphs exist is Solid logic: one <Path> per part, once typeset.
	const placed = useTrackValue(latex);
	const count = () => latex.peek()?.parts.length ?? 1;

	onSettled(() => {
		// `ready()` rejects (AbortError) if the formula goes away first.
		void latex
			.ready()
			.then(() => play(draw(progress, { duration: 2 })))
			.catch(() => {});
	});

	return (
		<For each={placed()?.parts ?? []}>
			{(part, i) => {
				const ink = derive(theme, (t) =>
					part.char === "x" ? t.palette.highlight : t.palette.foreground,
				);
				// Where this glyph stands in the write, as MathTex would write it:
				// outline first, then the fill comes up as the outline fades.
				const phase = derive(progress, (p) => writePhase(p, i(), count()));
				return (
					<Path
						points={part.polylines}
						closed
						fill={ink}
						fillOpacity={derive(phase, (p) => p.fill)}
						stroke={ink}
						strokeWidth={derive(
							phase,
							(p) => fontSize * OUTLINE_RATIO * (1 - p.fill),
						)}
						progress={derive(phase, (p) => p.border)}
					/>
				);
			}}
		</For>
	);
}

export default function ColoredFormula() {
	return (
		<Stage units={12}>
			<Formula />
		</Stage>
	);
}
