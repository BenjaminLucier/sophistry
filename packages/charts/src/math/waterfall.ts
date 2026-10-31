/**
 * Waterfall steps: a running total broken into the changes that built it.
 */

/**
 * One bar of a waterfall: where it starts and ends in data units, and what
 * kind of step it is.
 *
 * @category Math & helpers
 */
export interface WaterfallStep {
	/** The running total before this step (0 for a total bar). */
	base: number;
	/** The running total after this step. */
	end: number;
	/** The change itself, `end - base`. */
	delta: number;
	/** `"up"` or `"down"` for a change, `"total"` for a bar standing on zero. */
	kind: "up" | "down" | "total";
}

/**
 * Turns changes into floating bars, each starting where the running total
 * stood. An entry flagged as a total is drawn from zero to the running total
 * (its own value ignored). Non-finite changes count as 0.
 *
 * @param totals - Which entries are subtotal/total bars. Defaults to none.
 * @category Math & helpers
 */
export function waterfallSteps(
	deltas: readonly number[],
	totals: readonly boolean[] = [],
): WaterfallStep[] {
	let running = 0;
	return deltas.map((raw, i) => {
		if (totals[i]) {
			return { base: 0, end: running, delta: running, kind: "total" };
		}
		const delta = Number.isFinite(raw) ? raw : 0;
		const base = running;
		running += delta;
		return { base, end: running, delta, kind: delta < 0 ? "down" : "up" };
	});
}
