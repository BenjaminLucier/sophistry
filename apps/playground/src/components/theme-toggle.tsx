import {
	cycleModePreference,
	type ModePreference,
	modePreferenceReadable,
} from "@sophistry/core/themes";
import { useTrackValue } from "@sophistry/solidjs";

const LABEL: Record<ModePreference, string> = {
	system: "System",
	light: "Light",
	dark: "Dark",
};

const ICON: Record<ModePreference, string> = {
	system: "◐",
	light: "☀",
	dark: "☾",
};

/**
 * Cycles system → light → dark. It never decides the theme: it writes the
 * preference, and the page (`<html data-mode>`) and every `<Stage>` follow.
 */
export function ThemeToggle() {
	const preference = useTrackValue(modePreferenceReadable);
	return (
		<button
			type="button"
			class="rounded-md border border-rule px-3 py-1 text-sm hover:bg-surface"
			aria-label={`Theme: ${LABEL[preference()]}. Click to change.`}
			onClick={() => cycleModePreference()}
		>
			<span aria-hidden="true">{ICON[preference()]}</span> {LABEL[preference()]}
		</button>
	);
}
