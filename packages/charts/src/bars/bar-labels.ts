/**
 * `bars` `labels`: what each bar's value label and its stack's total write,
 * where they sit (past the bar's growing end, or inside it when it fits),
 * and the label props that draw them. Pure: `bars` builds one entry per
 * label on each update and keeps the label nodes in a keyed list.
 */

import type { CoordinateSystem, LabelProps } from "@sophistry/core";
import { DOWN, LEFT, RIGHT, UP } from "@sophistry/core";
import type { ColorInput } from "@sophistry/core/color";
import { mixColor as mixRgb, toCss } from "@sophistry/core/color";
import type {
	Bounds,
	TickFormatter,
	TickFormatterSpec,
} from "@sophistry/core/geometry";
import { formatTick, resolveTickFormatter } from "@sophistry/core/geometry";
import { measureLabel } from "@sophistry/core/internal";
import type { Theme } from "@sophistry/core/themes";
import type { Channel, ChannelFn } from "../data/channels.js";
import { resolveChannel } from "../data/channels.js";
import { decimalsOf, insideLabelFit } from "../math/barLabels.js";
import { readableOn } from "../mix.js";
import { besidePlace, labelStyle } from "./shared.js";

const DEFAULT_LABEL_FONT_SIZE = 0.24;
const DEFAULT_LABEL_OFFSET = 0.08;
const DEFAULT_INSIDE_PAD = 0.04;

/**
 * Where `bars` `labels` are written and how.
 *
 * @category Charts
 */
export interface BarLabelOptions<T> {
	/**
	 * Where each bar's label goes: `"inside"` centred in the bar (or its stacked segment), `"edge"`
	 * just past its end, `"none"` for no per-bar labels (e.g. only `total`).
	 * @default "inside"
	 */
	position?: "inside" | "edge" | "none";
	/** Your own text, a key of `T` or `(d, i) => string`, instead of the number. */
	text?: Channel<T, string>;
	/**
	 * How the number is written: a format string (`",.0f"`, `".1%"`), a built-in name (`"percent"`,
	 * `"si"`) or a function. Applies to totals too; under `offset="normalize"` segments show their
	 * share as a percent.
	 */
	format?: TickFormatterSpec;
	/**
	 * With `layout="stack"`, write each stack's total just past its end.
	 * @default false
	 */
	total?: boolean;
	/**
	 * Whether an inside label that doesn't fit its bar is hidden or drawn anyway.
	 * @default "hide"
	 */
	overflow?: "hide" | "show";
	/**
	 * Text colour. Defaults to the theme foreground outside the bar, and to whichever of foreground or
	 * background reads better on the fill inside it.
	 */
	color?: ColorInput;
	/**
	 * Gap in scene units between an edge label and the bar's end (inside: the room kept from each
	 * edge). Defaults to 0.08 (0.04 inside).
	 */
	offset?: number;
}

/** The label settings every bar of a `bars` shares, for one update. */
export interface BarLabels<T> {
	/** `labels` as options: undefined for `true` and a channel (the edge labels). */
	options: BarLabelOptions<T> | undefined;
	/** The custom text channel, if any. */
	custom: ChannelFn<T, string> | undefined;
	vertical: boolean;
	/** Where each bar's own label goes. */
	position: "inside" | "edge" | "none";
	fontSize: number;
	fontFamily: string;
	/** A number as labels write it: the `format`, else a normalized share as a percent, else with `rest`'s decimal places. */
	writeNumber(shown: number, rest: number, share: boolean): string;
}

/** Reads `bars`' label props into the settings every bar shares. */
export function barLabelSettings<T>(spec: {
	labels: boolean | Channel<T, string> | BarLabelOptions<T> | undefined;
	labelFontSize: number | undefined;
	vertical: boolean;
	coords: CoordinateSystem;
	theme: Theme;
	/** Whether the bars are a normalized stack (shares, written as percents). */
	normalized: boolean;
}): BarLabels<T> {
	const { labels } = spec;
	const options =
		typeof labels === "object" && labels !== null
			? (labels as BarLabelOptions<T>)
			: undefined;
	let custom: ChannelFn<T, string> | undefined;
	if (labels !== undefined && labels !== false && labels !== true) {
		const text = typeof labels === "object" ? options?.text : labels;
		custom =
			text === undefined
				? undefined
				: (resolveChannel(text as Channel<T, string>, undefined, "labels") as
						| ChannelFn<T, string>
						| undefined);
	}
	let format: TickFormatter | undefined;
	if (options?.format !== undefined) {
		const range = spec.vertical ? spec.coords.yRange() : spec.coords.xRange();
		format = resolveTickFormatter(options.format, formatTick, {
			range: [range[0], range[1]],
		});
	}
	return {
		options,
		custom,
		vertical: spec.vertical,
		position: labels
			? options
				? (options.position ?? "inside")
				: "edge"
			: "none",
		fontSize: spec.labelFontSize ?? DEFAULT_LABEL_FONT_SIZE,
		fontFamily: spec.theme.defaults.fontFamily,
		writeNumber(shown, rest, share) {
			if (format) return format(shown);
			const places = decimalsOf(rest);
			if (share && spec.normalized) {
				const percentPlaces = decimalsOf(Number((rest * 100).toFixed(1)));
				return `${formatTick(Number((shown * 100).toFixed(percentPlaces)), percentPlaces)}%`;
			}
			return formatTick(Number(shown.toFixed(places)), places);
		},
	};
}

/** What one bar's labels read from it on one frame. */
export interface BarLabelState<T> {
	key: unknown;
	datum: T;
	index: number;
	/** The value `labels={true}` writes. */
	value: number;
	/** The number option labels write: `value`, or a normalized segment's share. */
	share: number;
	/** Its stack's total when it carries it, else undefined. */
	total: number | undefined;
	/** 0..1: how present the bar is while entering or leaving. */
	presence: number;
	/** The bar as drawn, and at full length on this frame. */
	grown: Bounds;
	rest: Bounds | null;
	/** The bar's fade (1 when opaque). */
	opacity: number;
	/** The bar's reveal, 0..1. */
	t: number;
	/** A number counted up with the bar's reveal. */
	counted(value: number): number;
	color: string;
	/** True when the bar runs down (or left) from its foot. */
	backward: boolean;
	fillOpacity: number;
}

/** One label to draw: its key in the list and its props. */
export interface BarLabelEntry {
	key: string;
	props: LabelProps;
}

/**
 * One bar's edge label, inside label and stack total, as label props placed
 * on its box. Appends to `out`.
 */
export function barLabelEntries<T>(
	labels: BarLabels<T>,
	own: BarLabelState<T>,
	theme: Theme,
	layer: { zIndex: number | undefined; visible: boolean | undefined },
	out: BarLabelEntry[],
): void {
	if (labels.position === "none" && !labels.options?.total) return;
	/** The label rides the bar's growing end and counts up with it. */
	const text = (): string => {
		if (labels.custom) return labels.custom(own.datum, own.index) ?? "";
		if (!labels.options) {
			const places = decimalsOf(own.value);
			const shown = own.counted(own.value);
			return formatTick(Number(shown.toFixed(places)), places);
		}
		return labels.writeNumber(own.counted(own.share), own.share, true);
	};
	const opacity = Math.min(1, own.t * 4) * Math.min(1, own.presence);
	const box = own.grown;
	/** Where an edge label or total sits: just past the bar's growing end. */
	const edgeAt = labels.vertical
		? { x: (box.minX + box.maxX) / 2, y: own.backward ? box.minY : box.maxY }
		: { x: own.backward ? box.minX : box.maxX, y: (box.minY + box.maxY) / 2 };
	const direction = labels.vertical
		? own.backward
			? DOWN
			: UP
		: own.backward
			? LEFT
			: RIGHT;
	const gap = labels.options?.offset ?? DEFAULT_LABEL_OFFSET;
	const edgeColor = labels.options?.color ?? theme.palette.foreground;
	const edge = (key: string, content: string) =>
		out.push({
			key: `${String(own.key)}:${key}`,
			props: {
				text: content,
				place: besidePlace(
					content,
					edgeAt,
					direction,
					gap,
					labels.fontSize,
					labels.fontFamily,
				),
				fontSize: labels.fontSize,
				color: edgeColor,
				opacity,
				zIndex: layer.zIndex,
			},
		});
	if (labels.position === "edge") edge("edge", text());
	if (labels.position === "inside") {
		const inside = insideOpacity(labels, own, opacity);
		if (inside > 0)
			out.push({
				key: `${String(own.key)}:inside`,
				props: {
					text: text(),
					x: (box.minX + box.maxX) / 2,
					y: (box.minY + box.maxY) / 2,
					fontSize: labels.fontSize,
					color: insideColor(labels, own, theme),
					opacity: inside,
					zIndex: (layer.zIndex ?? 0) + 1,
					visible: layer.visible,
				},
			});
	}
	/** The stack's total, counting up with it, when this bar carries it. */
	if (own.total !== undefined && labels.options?.total) {
		const total = labels.writeNumber(own.counted(own.total), own.total, false);
		if (total) edge("total", total);
	}
}

/**
 * An inside label's opacity: the bar's fade times how well the label fits
 * the bar as it stands, so it grows in with its segment.
 */
function insideOpacity<T>(
	labels: BarLabels<T>,
	own: BarLabelState<T>,
	opacity: number,
): number {
	const full = own.rest;
	if (!full || own.share === 0) return 0;
	const fade = own.opacity * opacity;
	if (labels.options?.overflow === "show") return fade;
	// Measured at its full-length text, so a counting label doesn't flicker
	// in and out as its width changes.
	const shown = labels.custom
		? (labels.custom(own.datum, own.index) ?? "")
		: labels.writeNumber(own.share, own.share, true);
	const size = measureLabel(
		shown,
		labelStyle(labels.fontSize, labels.fontFamily),
	);
	return (
		fade *
		insideLabelFit(
			own.grown,
			full,
			{ width: size.width, height: size.ascent + size.descent },
			labels.options?.offset ?? DEFAULT_INSIDE_PAD,
			labels.vertical,
		)
	);
}

/** Inside text reads on the bar's fill as drawn: its colour over the background at its opacity. */
function insideColor<T>(
	labels: BarLabels<T>,
	own: BarLabelState<T>,
	theme: Theme,
): ColorInput {
	const chosen = labels.options?.color;
	if (chosen !== undefined) return chosen;
	const { foreground, background } = theme.palette;
	const fill = own.color ?? foreground;
	const drawn = toCss(mixRgb(background, fill, own.fillOpacity));
	return readableOn(drawn, foreground, background);
}
