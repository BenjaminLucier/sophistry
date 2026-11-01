/**
 * The panel a chart's tooltip is drawn on: `tooltipOverlay` draws a
 * {@link TooltipState}'s active tooltip by the pointer or above its datum,
 * kept inside the view, and in nearest-x mode the shared tooltip and its
 * crosshair while the pointer is over the plotting area.
 *
 * The chart creates one overlay and binds its `active`, `pointsVersion`,
 * `pointer` and `view` props to the tooltip state's and scene's `Readable`s,
 * so it updates exactly when one of them changes and costs nothing
 * otherwise.
 */

import type {
	CompositeContext,
	SceneNode,
	ScenePointer,
} from "@sophistry/core";
import {
	circle,
	defineComposite,
	Invalidate,
	label,
	line,
	measuresText,
	rect,
} from "@sophistry/core";
import type { Bounds, Point } from "@sophistry/core/geometry";
import { measureLabel } from "@sophistry/core/internal";
import type {
	ActiveTooltip,
	TooltipContent,
	TooltipPoint,
	TooltipRow,
	TooltipState,
} from "../tooltip.js";
import { nearestXIndex, placeTooltip } from "../tooltip.js";

const TIP_FONT_SIZE = 0.26;
const TIP_PAD = 0.12;
/** Line pitch of a tooltip's rows, in font sizes. */
const TIP_LINE = 1.35;
/** Room between a row's name and its value, in font sizes. */
const TIP_COLUMN_GAP = 0.7;
/** A row's colour swatch, and the room after it, in font sizes. */
const TIP_SWATCH = 0.6;
const TIP_SWATCH_GAP = 0.35;
/** Paint order above every chart layer. */
const TIP_Z = 1000;

/** A tooltip's content laid out at the origin: its lines, columns and size. */
export interface TooltipLayout {
	width: number;
	height: number;
	items: {
		name: string;
		value: string;
		/** Offsets from the panel's top-left corner. */
		nameX: number;
		valueX: number;
		y: number;
		color?: string;
	}[];
}

/**
 * Lays a tooltip's content out: rows in two columns (names, values), a
 * swatch column when any row has a colour, an optional heading line.
 *
 * @internal
 */
export function layoutTooltip(
	content: TooltipContent,
	fontFamily: string,
	heading?: string,
): TooltipLayout {
	const style = {
		fontSize: TIP_FONT_SIZE,
		fontFamily,
		fontWeight: 500,
		italic: false,
		letterSpacing: 0,
	};
	const bold = { ...style, fontWeight: 600 };
	const rows: readonly TooltipRow[] =
		typeof content === "string"
			? content
					.split("\n")
					.map((line) => ({ channel: "text", name: "", value: line }))
			: content;
	const all = heading
		? [{ channel: "heading", name: "", value: heading }, ...rows]
		: rows;
	const swatch = all.some((row) => row.color)
		? (TIP_SWATCH + TIP_SWATCH_GAP) * TIP_FONT_SIZE
		: 0;
	let names = 0;
	for (const row of all)
		if (row.name) names = Math.max(names, measureLabel(row.name, style).width);
	const gap = names > 0 ? TIP_COLUMN_GAP * TIP_FONT_SIZE : 0;
	let width = 0;
	const pitch = TIP_LINE * TIP_FONT_SIZE;
	const items = all.map((row, i) => {
		const valueX = row.name ? swatch + names + gap : swatch;
		const valueStyle = typeof content === "string" ? style : bold;
		width = Math.max(
			width,
			valueX + measureLabel(row.value, valueStyle).width,
			swatch + measureLabel(row.name, style).width,
		);
		return {
			name: row.name,
			value: row.value,
			nameX: TIP_PAD + swatch,
			valueX: TIP_PAD + valueX,
			y: TIP_PAD + pitch * (i + 0.5),
			...(row.color ? { color: row.color } : {}),
		};
	});
	return {
		items,
		width: width + 2 * TIP_PAD,
		height: pitch * all.length + 2 * TIP_PAD,
	};
}

/**
 * Props for {@link tooltipOverlay}.
 *
 * @category Extending
 */
export interface TooltipOverlayProps {
	/** The tooltip state to draw. */
	state: TooltipState | null;
	/** The plotting area, for nearest-x mode. */
	area?: Bounds;
	/** Bind to `state.active`. */
	active?: ActiveTooltip | null;
	/** Bind to `state.pointsVersion`. */
	pointsVersion?: number;
	/** Bind to the scene's pointer (`pointerContext`). */
	pointer?: ScenePointer | null;
	/** Bind to the scene's view (`frameContext`): the panel stays inside it. */
	view?: Bounds;
	zIndex?: number;
}

/** What an overlay keeps between updates. */
interface OverlayState {
	points: readonly TooltipPoint[] | null;
	nearest: ReturnType<typeof nearestXIndex> | null;
	layouts: WeakMap<object, { fontFamily: string; layout: TooltipLayout }>;
}

const overlays = new WeakMap<object, OverlayState>();

/** One panel's nodes: its background, then per row a swatch, name and value. */
function panelNodes(
	ctx: CompositeContext<TooltipOverlayProps>,
	slot: string,
	panel: { layout: TooltipLayout; box: Bounds; text: boolean } | undefined,
): SceneNode[] {
	const theme = ctx.theme;
	const fontFamily = theme.defaults.fontFamily;
	const nodes: SceneNode[] = [];
	const background = ctx.list(`${slot}Panel`, panel ? [panel] : [], {
		key: () => 0,
		create: () => rect.create({ width: 0, height: 0 }),
		update: (node, own) =>
			node.update({
				center: {
					x: (own.box.minX + own.box.maxX) / 2,
					y: (own.box.minY + own.box.maxY) / 2,
				},
				width: own.box.maxX - own.box.minX,
				height: own.box.maxY - own.box.minY,
				cornerRadius: 0.08,
				fill: theme.palette.surface,
				fillOpacity: 0.95,
				stroke: theme.palette.border,
				strokeWidth: 0.015,
				zIndex: TIP_Z,
			}),
	});
	nodes.push(...background);
	if (!panel) {
		ctx.list(`${slot}Rows`, [] as number[], {
			key: (i) => i,
			create: () => rect.create({ width: 0, height: 0 }),
		});
		return nodes;
	}
	const left = panel.box.minX;
	const top = panel.box.maxY;
	const parts: { key: string; kind: "swatch" | "name" | "value"; i: number }[] =
		[];
	panel.layout.items.forEach((item, i) => {
		if (item.color) parts.push({ key: `s${i}`, kind: "swatch", i });
		if (item.name) parts.push({ key: `n${i}`, kind: "name", i });
		parts.push({ key: `v${i}`, kind: "value", i });
	});
	const propsOf = (part: (typeof parts)[number]) => {
		const item = panel.layout.items[part.i] as TooltipLayout["items"][number];
		if (part.kind === "swatch")
			return {
				center: {
					x: left + TIP_PAD + (TIP_SWATCH * TIP_FONT_SIZE) / 2,
					y: top - item.y,
				},
				width: TIP_SWATCH * TIP_FONT_SIZE,
				height: TIP_SWATCH * TIP_FONT_SIZE,
				cornerRadius: 0.03,
				fill: item.color,
				stroke: "none",
				zIndex: TIP_Z + 1,
			};
		if (part.kind === "name")
			return {
				text: item.name,
				x: left + item.nameX,
				y: top - item.y,
				align: "left",
				fontSize: TIP_FONT_SIZE,
				fontFamily,
				color: theme.palette.muted,
				zIndex: TIP_Z + 1,
			};
		return {
			text: item.value,
			x: panel.text
				? (panel.box.minX + panel.box.maxX) / 2
				: left + item.valueX,
			y: top - item.y,
			align: panel.text ? "center" : "left",
			fontSize: TIP_FONT_SIZE,
			fontFamily,
			fontWeight: panel.text ? 500 : 600,
			color: theme.palette.foreground,
			zIndex: TIP_Z + 1,
		};
	};
	const rows = ctx.list(`${slot}Rows`, parts, {
		key: (part) => part.key,
		create: (part) =>
			(part.kind === "swatch" ? rect : label).create(propsOf(part) as never),
		update: (node, part) => node.update(propsOf(part) as never),
	});
	nodes.push(...rows);
	return nodes;
}

function build(ctx: CompositeContext<TooltipOverlayProps>): SceneNode[] {
	measuresText(ctx);
	let own = overlays.get(ctx.node);
	if (!own) {
		own = { points: null, nearest: null, layouts: new WeakMap() };
		overlays.set(ctx.node, own);
	}
	const props = ctx.props;
	const theme = ctx.theme;
	const fontFamily = theme.defaults.fontFamily;
	const state = props.state;
	const config = state?.config();
	const pointer = props.pointer?.scene ?? null;
	const view = props.view;

	/** The active tooltip's panel: by the pointer while it follows, else above its datum. */
	let placed: { layout: TooltipLayout; box: Bounds; text: boolean } | undefined;
	const tooltip = props.active ?? null;
	if (tooltip) {
		const follow =
			tooltip.follow && (config === false || config?.anchor !== "datum");
		const at: Point = (follow ? pointer : null) ?? tooltip.at;
		let kept = own.layouts.get(tooltip);
		if (!kept || kept.fontFamily !== fontFamily) {
			kept = { fontFamily, layout: layoutTooltip(tooltip.content, fontFamily) };
			own.layouts.set(tooltip, kept);
		}
		placed = {
			layout: kept.layout,
			box: placeTooltip(kept.layout, at, view),
			text: typeof tooltip.content === "string",
		};
	}

	/** The shared nearest-x tooltip, while the mode is on and the pointer is over the plot. */
	let shared:
		| {
				x: number;
				points: TooltipPoint[];
				panel: { layout: TooltipLayout; box: Bounds; text: boolean };
		  }
		| undefined;
	const area = props.area;
	if (state && config && config.mode === "x" && area && pointer) {
		const points = state.points();
		if (own.points !== points || !own.nearest) {
			own.points = points;
			own.nearest = nearestXIndex(points);
		}
		const inside =
			pointer.x >= area.minX &&
			pointer.x <= area.maxX &&
			pointer.y >= area.minY &&
			pointer.y <= area.maxY;
		const found = inside ? own.nearest(pointer.x) : undefined;
		if (found) {
			const layout = layoutTooltip(
				found.points.map((point) => point.row),
				fontFamily,
				found.points[0]?.x,
			);
			const y = Math.min(Math.max(pointer.y, area.minY), area.maxY);
			shared = {
				x: found.x,
				points: found.points,
				panel: {
					layout,
					box: placeTooltip(layout, { x: found.x, y }, view, "right"),
					text: false,
				},
			};
		}
	}

	const nodes = panelNodes(ctx, "item", placed);
	const crosshair = ctx.list("crosshair", shared ? [shared] : [], {
		key: () => 0,
		create: () => line.create({ from: { x: 0, y: 0 }, to: { x: 0, y: 0 } }),
		update: (node, own) =>
			node.update({
				from: { x: own.x, y: area?.minY ?? 0 },
				to: { x: own.x, y: area?.maxY ?? 0 },
				stroke: theme.palette.muted,
				strokeWidth: 0.015,
				opacity: 0.8,
				zIndex: TIP_Z - 2,
			}),
	});
	const markers = ctx.list("markers", shared?.points ?? [], {
		key: (point) => point,
		create: () => circle.create({ radius: 0 }),
		update: (node, point) =>
			node.update({
				center: point.at,
				radius: 0.07,
				fill: point.row.color ?? theme.palette.foreground,
				stroke: theme.palette.background,
				strokeWidth: 0.02,
				zIndex: TIP_Z - 1,
			}),
	});
	return [
		...nodes,
		...crosshair,
		...markers,
		...panelNodes(ctx, "shared", shared?.panel),
	];
}

/**
 * Draws a {@link TooltipState}'s active tooltip on a small panel, by the
 * pointer or above its datum, kept inside the view; in nearest-x mode, the
 * shared tooltip and crosshair while the pointer is over `area`. A chart
 * makes one; make your own for a tooltip state you keep yourself.
 *
 * @category Extending
 */
export const tooltipOverlay = defineComposite<TooltipOverlayProps>({
	name: "TooltipOverlay",
	props: {
		state: { default: null, invalidates: Invalidate.UPDATE },
		area: { invalidates: Invalidate.UPDATE },
		active: { default: null, invalidates: Invalidate.UPDATE },
		pointsVersion: { default: 0, invalidates: Invalidate.UPDATE },
		pointer: { default: null, invalidates: Invalidate.UPDATE },
		view: { invalidates: Invalidate.UPDATE },
		zIndex: { invalidates: Invalidate.UPDATE },
	},
	setup: build,
	update: (_changed, ctx) => build(ctx),
});
