import { moveTo, trackPoint } from "@sophistry/core";
import {
	Circle,
	Dot,
	MultiStage,
	PictureInPicture,
	usePlayer,
	useTheme,
} from "@sophistry/solidjs";
import { onSettled } from "solid-js";

const ORBIT = [
	{ x: 0, y: 2 },
	{ x: -2, y: 0 },
	{ x: 0, y: -2 },
	{ x: 2, y: 0 },
];

/**
 * One scene, two views: the full frame plus a
 * magnified inset whose camera tracks the moving dot. The scene is described
 * once; `<PictureInPicture>` only adds cameras. The inset's `center` is the
 * dot's track itself (bound, no Solid work per frame).
 */
export function ViewsDemo() {
	const theme = useTheme();
	const dot = trackPoint(2, 0);
	const player = usePlayer();

	onSettled(() => {
		void (async () => {
			for (const at of ORBIT) {
				await player.play(moveTo(dot, at, { duration: 1 }));
			}
		})();
	});

	return (
		<MultiStage units={10}>
			<Circle center={{ x: 0, y: 0 }} radius={2} />
			<Dot center={dot} />
			<PictureInPicture
				main={{}}
				inset={{ units: 4, center: dot, border: theme().palette.accent }}
				corner="bottom-left"
			/>
		</MultiStage>
	);
}
