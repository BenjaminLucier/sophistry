import {
	draggable,
	dropTarget,
	fadeIn,
	indicate,
	moveTo,
	sequence,
	track,
	trackPoint,
} from "@sophistry/core";
import {
	Circle,
	Label,
	Rect,
	Stage,
	usePlayer,
	useTheme,
} from "@sophistry/solidjs";
import { createSignal } from "solid-js";

export const meta = {
	title: "Step-through lesson",
	description:
		"Drag the token onto the right answer to unlock Next. Wrong drops bounce back; Tab to a box and press Enter to answer without a pointer.",
};

const QUESTIONS = [
	{ prompt: "What is 2 + 3?", options: [4, 5, 6], answer: 5 },
	{ prompt: "What is 3 × 3?", options: [6, 9, 12], answer: 9 },
	{ prompt: "What is 10 − 7?", options: [2, 3, 4], answer: 3 },
];
const BOX_X = [-3.2, 0, 3.2];
const HOME = { x: 0, y: -1.8 };

export default function StepThroughLesson() {
	const theme = useTheme();
	const palette = () => theme().palette;
	const { play } = usePlayer();

	const [step, setStep] = createSignal(0);
	const [solved, setSolved] = createSignal(false);
	const [feedback, setFeedback] = createSignal(
		"Drag the token onto an answer.",
	);
	const token = trackPoint(HOME.x, HOME.y);
	const tokenScale = track(1);
	const promptOpacity = track(1);
	const over = QUESTIONS[0].options.map(() => createSignal(false));

	const question = () => QUESTIONS[Math.min(step(), QUESTIONS.length - 1)];
	const finished = () => step() >= QUESTIONS.length;

	function answer(index: number) {
		if (solved() || finished()) return;
		const value = question().options[index];
		if (value === question().answer) {
			setSolved(true);
			setFeedback(`Correct, ${value}! Press Next.`);
			void play(
				sequence(
					moveTo(token, { x: BOX_X[index], y: 0.8 }, { duration: 0.3 }),
					indicate(tokenScale, { factor: 1.4 }),
				),
			);
		} else {
			setFeedback(`${value} is not it. Try again.`);
			void play(moveTo(token, HOME, { duration: 0.25 }));
		}
	}

	function next() {
		setStep((s) => s + 1);
		setSolved(false);
		token.set(HOME);
		if (finished()) {
			setFeedback("Lesson complete.");
			return;
		}
		setFeedback("Drag the token onto an answer.");
		promptOpacity.set(0);
		void play(fadeIn(promptOpacity, { duration: 0.5 }));
	}

	const drag = draggable(token, {
		disabled: solved,
		onDragEnd: () => {
			if (!solved()) token.set(HOME);
		},
	});

	return (
		<div>
			<Stage units={10} aspect={1.75}>
				{BOX_X.map((x, i) => (
					<>
						<Rect
							center={{ x: x, y: 0.8 }}
							width={2.6}
							height={1.6}
							cornerRadius={0.2}
							fill={
								solved() && question().options[i] === question().answer
									? palette().series[1]
									: over[i][0]()
										? palette().highlight
										: palette().surface
							}
							label={finished() ? undefined : `Answer ${question().options[i]}`}
							onTap={() => answer(i)}
							{...dropTarget({ over: over[i][1], onDrop: () => answer(i) })}
						/>
						<Label
							text={finished() ? "" : String(question().options[i])}
							x={x}
							y={0.8}
							fontSize={0.6}
						/>
					</>
				))}
				<Label
					text={finished() ? "All done!" : question().prompt}
					y={2.4}
					fontSize={0.6}
					opacity={promptOpacity}
				/>
				<Circle
					center={token}
					radius={0.35}
					scale={tokenScale}
					fill={palette().series[0]}
					label="answer token"
					{...drag}
				/>
			</Stage>
			<div
				style={{
					display: "flex",
					gap: "1rem",
					"align-items": "center",
					"margin-top": "0.5rem",
				}}
			>
				<span style={{ flex: "1" }} role="status" aria-live="polite">
					{feedback()}
				</span>
				<span>
					{Math.min(step() + 1, QUESTIONS.length)} / {QUESTIONS.length}
				</span>
				<button type="button" disabled={!solved()} onClick={next}>
					Next
				</button>
			</div>
		</div>
	);
}
