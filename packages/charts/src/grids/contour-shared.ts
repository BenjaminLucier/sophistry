/**
 * What the contour layers share (`contour`, `contourF`, `triContour`,
 * `triContourF`): the default two-colour ramp, the colour of a level or a
 * band, and their path batch items. Lines and bands have an outline each, so
 * every contour layer is one path batch: a line draws along its length (the
 * item's `progress`), a band comes up with its
 * `progress` or fades through its opacity. Internal to the charts.
 */

import type {
	ColorRampSpec,
	CoordinateSystem,
	PathBatchItem,
} from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";
import { resolveColorRamp } from "@sophistry/core/internal";
import type { Colormap, Theme } from "@sophistry/core/themes";
import type { ColorNorm } from "../color-norm.js";
import { projectRun } from "../raster.js";

/** The contours' colormap: the given ramp, else two theme series colours. */
export function contourRamp(
	spec: ColorRampSpec | undefined,
	theme: Theme,
): Colormap {
	return resolveColorRamp(spec, () => [
		theme.palette.series[1] ?? theme.palette.muted,
		theme.palette.series[0] ?? theme.palette.foreground,
	]);
}

/** A level's colour: its place on the norm, else between the field's min and max. */
export function levelColor(
	ramp: Colormap,
	norm: ColorNorm | undefined,
	extent: readonly [number, number],
	level: number,
): string {
	if (norm) return ramp(norm.unit(level));
	const [min, max] = extent;
	return ramp(max > min ? (level - min) / (max - min) : 0);
}

/** A band's colour: its middle along the norm (a geometric mean on a log norm), else its midpoint between the field's min and max. */
export function bandColor(
	ramp: Colormap,
	norm: ColorNorm | undefined,
	extent: readonly [number, number],
	lo: number,
	hi: number,
): string {
	if (norm) return ramp((norm.unit(lo) + norm.unit(hi)) / 2);
	const [min, max] = extent;
	const mid = (lo + hi) / 2;
	return ramp(max > min ? (mid - min) / (max - min) : 0);
}

/** One iso-line placed in scene units, with what its reveal reads. */
export interface PlacedLine {
	item: PathBatchItem;
	level: number;
}

/** Iso-lines as open path batch items in scene units, stroked by level. */
export function placeLines(
	lines: readonly { level: number; points: readonly Point[] }[],
	coords: Pick<CoordinateSystem, "coordsToPoint">,
	strokeOf: (level: number) => string,
): PlacedLine[] {
	return lines.map((line) => {
		return {
			level: line.level,
			item: {
				closed: false,
				polylines: [projectRun(coords, line.points)],
				stroke: strokeOf(line.level),
			},
		};
	});
}

/**
 * The lines at this frame of the reveal: whole at 1 (the placed items),
 * traced along their length below it (the placed outline with that
 * `progress`, so its arc length is measured once), left out at 0.
 */
export function revealLines(
	placed: readonly PlacedLine[],
	revealOf: (level: number) => number,
): PathBatchItem[] {
	return revealItems(placed, (line) => revealOf(line.level));
}

/** Placed items at this frame of a reveal: whole at 1, with their `progress` below it, left out at 0. */
function revealItems<T extends { item: PathBatchItem }>(
	placed: readonly T[],
	revealOf: (entry: T) => number,
): PathBatchItem[] {
	const out: PathBatchItem[] = [];
	for (const entry of placed) {
		const reveal = revealOf(entry);
		if (!(reveal > 0)) continue;
		out.push(reveal >= 1 ? entry.item : { ...entry.item, progress: reveal });
	}
	return out;
}

/** One band placed in scene units. */
export interface PlacedBand {
	item: PathBatchItem;
	loLevel: number;
}

/** Bands as closed path batch items in scene units (all of a band's rings one item). */
export function placeBands(
	bands: readonly {
		loLevel: number;
		hiLevel: number;
		polygons: readonly (readonly Point[])[];
	}[],
	coords: Pick<CoordinateSystem, "coordsToPoint">,
	fillOf: (lo: number, hi: number) => string,
): PlacedBand[] {
	return bands.map((band) => ({
		loLevel: band.loLevel,
		item: {
			closed: true,
			polylines: band.polygons.map((ring) => projectRun(coords, ring)),
			fill: fillOf(band.loLevel, band.hiLevel),
		},
	}));
}

/**
 * The bands at this frame of a reveal: whole at 1, each band's fill coming
 * up (and any stroke tracing) with its `progress` below it, left out at 0.
 * Unstaggered `contourF` bands use it.
 */
export function revealBands(
	placed: readonly PlacedBand[],
	revealOf: (level: number) => number,
): PathBatchItem[] {
	return revealItems(placed, (band) => revealOf(band.loLevel));
}

/** The bands at this frame of a fade: kept whole at 1, faded below it, left out at 0. */
export function fadeBands(
	placed: readonly PlacedBand[],
	fadeOf: (level: number) => number,
): PathBatchItem[] {
	const out: PathBatchItem[] = [];
	for (const band of placed) {
		const fade = fadeOf(band.loLevel);
		if (!(fade > 0)) continue;
		out.push(fade >= 1 ? band.item : { ...band.item, opacity: fade });
	}
	return out;
}
