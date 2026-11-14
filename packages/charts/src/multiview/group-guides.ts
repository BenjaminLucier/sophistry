/**
 * The guides a group of panels draws once for all of them (title, outer
 * axis titles, one legend, size keys, one colour bar) and the room they
 * take. Internal: used by `facet`, `pairPlot` and `jointPlot`.
 *
 * {@link createGroupGuides} is made once in the preset's `setup`; each
 * update calls `measure(...)` (the room, read before laying the grid out)
 * and then `draw(...)` (the nodes, placed around the laid-out grid). Nodes
 * are kept by role, so updates write props instead of rebuilding.
 */

import type { SceneNode } from "@sophistry/core";
import { DOWN, text, UP } from "@sophistry/core";
import type { Bounds, Point } from "@sophistry/core/geometry";
import { anchoredLabelProps } from "@sophistry/core/internal";
import type { Theme } from "@sophistry/core/themes";
import {
	AXIS_LABEL_FONT_SIZE,
	AXIS_LABEL_GAP,
	COLORBAR_THICKNESS,
	halfLine,
	KEYS_GAP,
	LEGEND_GAP,
	TITLE_FONT_SIZE,
	TITLE_GAP,
} from "../frame/guide-metrics.js";
import type {
	ChartSizeLegendOptions,
	RampExtent,
	SizeExtent,
} from "../frame/types.js";
import { colorbar, colorbarWidth } from "../guides/colorbar.js";
import { legend, measureLegend } from "../guides/legend.js";
import type { SizeKeysEnds } from "../guides/size-legend.js";
import {
	measureSizeKeys,
	sizeKeyOffsets,
	sizeKeyStack,
} from "../guides/size-legend.js";
import type { SideRoom } from "../math/facet.js";
import { stageProgress } from "../math/join.js";
import type { ChartGroup } from "./chart-group.js";
import { sizeKeysOf } from "./chart-group.js";

/** Where a group's panels' share of `progress` ends when a legend or colour bar follows. */
export const PANELS_END_WITH_GUIDES = 0.9;

/** No size keys: one shared empty list. */
const NO_KEYS: readonly SizeExtent[] = [];

/** What a group draws once, and how. */
export interface GroupGuideOptions {
	title?: string;
	titleFontSize?: number;
	/** One title under the grid, centred. */
	xLabel?: string;
	/** One title left of the grid, centred and turned to read upward. */
	yLabel?: string;
	axisLabelFontSize?: number;
	/** Draw the shared legend (when a layer reports a series): on the right (`true`, `"right"`) or in a row over the grid (`"top"`). */
	legend?: boolean | "right" | "top";
	/** How wide a top legend's row may run before it wraps: the grid's footprint. */
	legendWidth?: number;
	legendTitle?: string;
	legendFontSize?: number;
	/**
	 * Size keys for layers that size marks by value, one per distinct
	 * `sizeRange`, drawn with the legend. A key is drawn only when every
	 * panel's layers on that range share one scale. `false` (or
	 * `legend: false`) hides them; an object tunes them as `chart`'s `sizeLegend`.
	 * @default true
	 */
	sizeLegend?: boolean | ChartSizeLegendOptions;
	/** How tall the keys on the right may stack before the size key moves beside the legend. */
	keysHeight?: number;
	/** Draw one colour bar from the first value-coloured layer. */
	colorbar?: boolean;
	colorbarLabel?: string;
}

/** What `measure` works out: the room, and what `draw` places. */
export interface GroupGuideMeasure {
	/** The room the group's own guides take outside the panels' guides, per side. */
	room: SideRoom;
	/** The room above and below the grid alone (top legend, title, x title). */
	vertical: { top: number; bottom: number };
	/** Whether a legend, size key or colour bar comes last in the reveal. */
	guided: boolean;
	legendShown: boolean;
	legendTop: boolean;
	legendSize: { width: number; height: number } | undefined;
	sizeKeys: readonly SizeExtent[];
	size: SizeKeysEnds | undefined;
	/** The legend and size key placed together, as `chart` places them. */
	keys:
		| {
				width: number;
				height: number;
				presence: number;
				sizeAt: Point;
		  }
		| undefined;
	ramp: RampExtent | undefined;
	labelSize: number;
}

/** Where `draw` places the guides. */
export interface GroupGuidePlacement {
	/** The box around every panel's plotting area. */
	plots: Bounds;
	/** The room the panels' own guides take around that box. */
	panelRoom: SideRoom;
	/** The box the axis titles centre on, when not all of `plots` (a joint plot's main panel). */
	labelBox?: Bounds;
	frameProgress: number;
	legendProgress: number;
	zIndex?: number;
	visible?: boolean;
}

/** A group's guides: measure, then draw. */
export interface GroupGuides {
	measure(
		group: ChartGroup,
		options: GroupGuideOptions,
		theme: Theme,
	): GroupGuideMeasure;
	draw(
		group: ChartGroup,
		options: GroupGuideOptions,
		measured: GroupGuideMeasure,
		at: GroupGuidePlacement,
		theme: Theme,
	): SceneNode[];
	/** Disposes the nodes it keeps. */
	dispose(): void;
}

/** Makes a group's guides. Call once, in the preset's `setup`. */
export function createGroupGuides(): GroupGuides {
	const nodes: Record<string, SceneNode | null> = {
		title: null,
		xLabel: null,
		yLabel: null,
		legend: null,
		sizeKeys: null,
		colorbar: null,
	};
	/** Keeps a node by role: updates the kept one, makes one, or drops it. */
	const keep = (
		role: string,
		props: Record<string, unknown> | null,
		make: (props: Record<string, unknown>) => SceneNode,
	): SceneNode | null => {
		const existing = nodes[role];
		if (!props) {
			existing?.dispose();
			nodes[role] = null;
			return null;
		}
		if (existing) existing.update(props as never);
		else nodes[role] = make(props);
		return nodes[role] as SceneNode;
	};

	return {
		measure(group, options, theme) {
			const fontFamily = theme.defaults.fontFamily;
			const entries = group.legendEntries();
			const legendShown =
				options.legend !== false &&
				entries.length > 0 &&
				group.all().some((report) => report.color);
			const legendTop = options.legend === "top";
			const legendSize = legendShown
				? measureLegend(entries, {
						direction: legendTop ? "row" : "column",
						maxWidth: legendTop ? options.legendWidth : undefined,
						title: options.legendTitle,
						fontSize: options.legendFontSize,
						fontFamily,
					})
				: undefined;
			const sizeOptions =
				typeof options.sizeLegend === "object" ? options.sizeLegend : {};
			let sizeKeys: readonly SizeExtent[] = NO_KEYS;
			if (options.legend !== false && options.sizeLegend !== false) {
				const keys = sizeKeysOf(
					group.all().map((report) => report.size),
					(size) => group.sizeOf(size),
					true,
				);
				if (keys.length > 0) sizeKeys = keys;
			}
			const height = legendTop ? undefined : options.keysHeight;
			const size =
				sizeKeys.length === 0
					? undefined
					: measureSizeKeys(
							sizeKeys,
							{
								direction: legendTop ? "row" : "column",
								maxWidth: legendTop ? options.legendWidth : undefined,
								title: sizeOptions.title,
								values: sizeOptions.values,
								fontSize: options.legendFontSize,
								format: sizeOptions.format,
								fontFamily,
							},
							KEYS_GAP,
							height === undefined
								? undefined
								: { maxHeight: height, gap: LEGEND_GAP },
						);
			// The size keys' size now: blended on the update stage while a transition rescales them.
			const stages = group.stages();
			const blend = group.blend();
			const update =
				stages && blend !== undefined
					? stageProgress(blend, stages.update, stages.eased)
					: 0;
			const sizeNow = size
				? size.to
					? {
							width:
								size.from.width + (size.to.width - size.from.width) * update,
							height:
								size.from.height + (size.to.height - size.from.height) * update,
							presence:
								size.from.presence +
								(size.to.presence - size.from.presence) * update,
						}
					: size.from
				: undefined;
			let keys: GroupGuideMeasure["keys"];
			if (legendSize || sizeNow) {
				if (!legendSize || !sizeNow) {
					keys = {
						width: legendSize?.width ?? sizeNow?.width ?? 0,
						height: legendSize?.height ?? sizeNow?.height ?? 0,
						presence: legendSize ? 1 : (sizeNow?.presence ?? 0),
						sizeAt: { x: 0, y: 0 },
					};
				} else {
					const gap = KEYS_GAP * sizeNow.presence;
					const stacked = legendSize.height + gap + sizeNow.height;
					const room = options.keysHeight;
					if (legendTop || room === undefined || stacked <= room) {
						keys = {
							width: Math.max(legendSize.width, sizeNow.width),
							height: stacked,
							presence: 1,
							sizeAt: { x: 0, y: -(legendSize.height + gap) },
						};
					} else {
						const besideGap = LEGEND_GAP * sizeNow.presence;
						keys = {
							width: legendSize.width + besideGap + sizeNow.width,
							height: Math.max(legendSize.height, sizeNow.height),
							presence: 1,
							sizeAt: { x: legendSize.width + besideGap, y: 0 },
						};
					}
				}
			}
			const ramp = options.colorbar ? group.ramp() : undefined;
			const barWidth = ramp
				? colorbarWidth(
						{
							domain: ramp.domain,
							scale: ramp.scale,
							thickness: COLORBAR_THICKNESS,
							label: options.colorbarLabel,
						},
						fontFamily,
					)
				: 0;
			const labelSize = options.axisLabelFontSize ?? AXIS_LABEL_FONT_SIZE;
			const topKeys = legendTop ? keys : undefined;
			const vertical = {
				top:
					(topKeys ? LEGEND_GAP * topKeys.presence + topKeys.height : 0) +
					(options.title
						? TITLE_GAP + (options.titleFontSize ?? TITLE_FONT_SIZE) * 1.2
						: 0),
				bottom: options.xLabel ? AXIS_LABEL_GAP + labelSize * 1.2 : 0,
			};
			const rightKeys = legendTop ? undefined : keys;
			return {
				room: {
					right:
						(rightKeys
							? LEGEND_GAP * rightKeys.presence + rightKeys.width
							: 0) + (barWidth > 0 ? LEGEND_GAP + barWidth : 0),
					top: vertical.top,
					bottom: vertical.bottom,
					left: options.yLabel ? AXIS_LABEL_GAP + labelSize * 1.2 : 0,
				},
				vertical,
				guided: legendShown || sizeKeys.length > 0 || ramp !== undefined,
				legendShown,
				legendTop,
				legendSize: legendSize
					? { width: legendSize.width, height: legendSize.height }
					: undefined,
				sizeKeys,
				size,
				keys,
				ramp,
				labelSize,
			};
		},

		draw(group, options, measured, at, theme) {
			const out: SceneNode[] = [];
			const push = (node: SceneNode | null) => {
				if (node) out.push(node);
			};
			const fontFamily = theme.defaults.fontFamily;
			const foreground = theme.palette.foreground;
			const { plots, panelRoom } = at;
			const midX = (plots.minX + plots.maxX) / 2;
			const labels = at.labelBox ?? plots;
			const labelX = (labels.minX + labels.maxX) / 2;
			const labelY = (labels.minY + labels.maxY) / 2;
			const size = measured.labelSize;
			const keysBox = measured.keys;
			const topLegend =
				measured.legendTop && keysBox
					? LEGEND_GAP * keysBox.presence + keysBox.height
					: 0;
			const anchored = (
				role: string,
				content: string | undefined,
				point: Point,
				direction: typeof UP,
				gap: number,
				fontSize: number,
			) =>
				push(
					keep(
						role,
						content
							? {
									...anchoredLabelProps(
										{
											text: content,
											at: point,
											direction,
											gap,
											fontSize,
											color: foreground,
											zIndex: at.zIndex,
											progress: at.frameProgress,
										},
										fontFamily,
										nodes[role]?.get("place" as never),
									),
									visible: at.visible,
								}
							: null,
						(props) => text.create(props as never),
					),
				);
			anchored(
				"title",
				options.title,
				{ x: midX, y: plots.maxY },
				UP,
				TITLE_GAP + panelRoom.top + topLegend,
				options.titleFontSize ?? TITLE_FONT_SIZE,
			);
			anchored(
				"xLabel",
				options.xLabel,
				{ x: labelX, y: plots.minY },
				DOWN,
				AXIS_LABEL_GAP + panelRoom.bottom,
				size,
			);
			push(
				keep(
					"yLabel",
					options.yLabel
						? {
								text: options.yLabel,
								x:
									plots.minX - panelRoom.left - AXIS_LABEL_GAP - halfLine(size),
								y: labelY,
								rotation: Math.PI / 2,
								fontSize: size,
								color: foreground,
								zIndex: at.zIndex,
								visible: at.visible,
								progress: at.frameProgress,
							}
						: null,
					(props) => text.create(props as never),
				),
			);
			/** The keys' top-left corner: the legend's, and the size key's without one. */
			const keysAt = measured.legendTop
				? { x: plots.minX, y: plots.maxY + panelRoom.top + topLegend }
				: { x: plots.maxX + panelRoom.right + LEGEND_GAP, y: plots.maxY };
			push(
				keep(
					"legend",
					measured.legendShown
						? {
								entries: group.legendEntries(),
								at: keysAt,
								direction: measured.legendTop ? "row" : "column",
								maxWidth: measured.legendTop ? options.legendWidth : undefined,
								title: options.legendTitle,
								fontSize: options.legendFontSize,
								progress: at.legendProgress,
								zIndex: at.zIndex,
								visible: at.visible,
							}
						: null,
					(props) => legend.create(props as never),
				),
			);
			const offset =
				measured.legendSize && keysBox ? keysBox.sizeAt : undefined;
			const sizeAt = offset
				? { x: keysAt.x + offset.x, y: keysAt.y + offset.y }
				: keysAt;
			const sizeOptions =
				typeof options.sizeLegend === "object" ? options.sizeLegend : {};
			const stages = group.stages();
			const blend = group.blend();
			const update =
				stages && blend !== undefined
					? stageProgress(blend, stages.update, stages.eased)
					: 0;
			push(
				keep(
					"sizeKeys",
					measured.sizeKeys.length > 0
						? {
								keys: measured.sizeKeys,
								offsets: sizeKeyOffsets(measured.size, update),
								at: sizeAt,
								title: sizeOptions.title,
								values: sizeOptions.values,
								format: sizeOptions.format,
								direction: measured.legendTop ? "row" : "column",
								maxWidth: measured.legendTop ? options.legendWidth : undefined,
								fontSize: options.legendFontSize,
								progress: at.legendProgress,
								zIndex: at.zIndex,
								visible: at.visible,
							}
						: null,
					(props) => sizeKeyStack.create(props as never),
				),
			);
			const ramp = measured.ramp;
			push(
				keep(
					"colorbar",
					ramp
						? {
								domain: ramp.domain,
								scale: ramp.scale,
								ramp: ramp.colormap,
								at: {
									x:
										plots.maxX +
										panelRoom.right +
										LEGEND_GAP +
										(keysBox && !measured.legendTop
											? keysBox.width + LEGEND_GAP * keysBox.presence
											: 0),
									y: plots.minY,
								},
								length: plots.maxY - plots.minY,
								thickness: COLORBAR_THICKNESS,
								label: options.colorbarLabel,
								progress: at.legendProgress,
								zIndex: at.zIndex,
								visible: at.visible,
							}
						: null,
					(props) => colorbar.create(props as never),
				),
			);
			return out;
		},

		dispose() {
			for (const role of Object.keys(nodes)) {
				nodes[role]?.dispose();
				nodes[role] = null;
			}
		},
	};
}
