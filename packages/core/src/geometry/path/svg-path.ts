/**
 * SVG path data in and out: parsing, flattening to subpaths, conversion to
 * `CurvePath`s, and the polyline/curve-path conversions and serialization.
 */

import {
	arcToCubics,
	flattenCubic,
	flattenCubicPolyline,
	lineSegment,
	quadraticToCubic,
} from "./cubic";
import type {
	CurvePath,
	CurveSegment,
	Point,
	Polyline,
	Subpath,
} from "./types";

const NUMBER = /-?\d*\.?\d+(?:[eE][-+]?\d+)?/;

/**
 * One parsed SVG path command with its numeric arguments (see {@link parsePathData}).
 *
 * @category Paths
 */
export interface PathSegment {
	command: string;
	args: number[];
}

/** Number of arguments each SVG path command consumes per repetition. */
const ARITY: Record<string, number> = {
	M: 2,
	L: 2,
	H: 1,
	V: 1,
	C: 6,
	S: 4,
	Q: 4,
	T: 2,
	A: 7,
	Z: 0,
};

/**
 * Tokenizes SVG path data into single-repetition segments, expanding implicit
 * repeats (`M 0 0 1 1` becomes an `M` followed by an `L`).
 *
 * @param d - SVG path data string.
 * @returns A list of `{ command, args }` with one repetition per entry.
 *
 * @category Paths
 */
export function parsePathData(d: string): PathSegment[] {
	const segments: PathSegment[] = [];
	let command = "";
	let args: number[] = [];

	const flush = () => {
		if (!command) return;
		const arity = ARITY[command.toUpperCase()] ?? 0;
		if (arity === 0) {
			segments.push({ command, args: [] });
		} else {
			for (let i = 0; i + arity <= args.length; i += arity) {
				// An implicit repeat of `M`/`m` is a line, per the SVG spec.
				const implicit = i > 0 && (command === "M" || command === "m");
				segments.push({
					command: implicit ? (command === "M" ? "L" : "l") : command,
					args: args.slice(i, i + arity),
				});
			}
		}
		args = [];
	};

	// Hand-rolled scan: arc flags are single `0`/`1` characters that may be
	// packed against the next number (`a1 1 0 011 1`), which a number regex
	// alone cannot split.
	const number = new RegExp(NUMBER.source, "y");
	let pos = 0;
	while (pos < d.length) {
		const ch = d[pos];
		if (/[MmLlHhVvCcSsQqTtAaZz]/.test(ch)) {
			flush();
			command = ch;
			pos++;
			continue;
		}
		if ((command === "A" || command === "a") && /[01]/.test(ch)) {
			const slot = args.length % 7;
			if (slot === 3 || slot === 4) {
				args.push(ch === "1" ? 1 : 0);
				pos++;
				continue;
			}
		}
		number.lastIndex = pos;
		const match = number.exec(d);
		if (match) {
			args.push(Number.parseFloat(match[0]));
			pos = number.lastIndex;
		} else {
			pos++;
		}
	}
	flush();

	return segments;
}

/**
 * Flattens SVG path data into polylines. `tolerance` is relative to chord
 * length, so it behaves the same at any scale; closed subpaths (`Z`) repeat
 * their first point.
 *
 * @param d - SVG path data string.
 * @param tolerance - Relative flatness budget. Defaults to 0.0005.
 * @returns One subpath per `M`; subpaths with fewer than two points are dropped.
 *
 * @category Paths
 */
export function flattenPath(d: string, tolerance = 0.0005): Subpath[] {
	const subpaths: Subpath[] = [];
	let current: Subpath | null = null;
	let cursor: Point = { x: 0, y: 0 };
	let start: Point = { x: 0, y: 0 };
	// Reflection anchors for the smooth variants (`S`/`T`).
	let lastCubicControl: Point | null = null;
	let lastQuadControl: Point | null = null;

	const begin = (p: Point) => {
		current = { points: [p], closed: false };
		subpaths.push(current);
	};
	const lineTo = (p: Point) => {
		if (!current) begin({ ...cursor });
		current?.points.push(p);
	};
	const cubicTo = (c1: Point, c2: Point, end: Point) => {
		if (!current) begin({ ...cursor });
		if (current)
			flattenCubic(current.points, cursor, c1, c2, end, tolerance, 0);
	};

	for (const { command, args } of parsePathData(d)) {
		const relative = command === command.toLowerCase();
		const ox = relative ? cursor.x : 0;
		const oy = relative ? cursor.y : 0;

		switch (command.toUpperCase()) {
			case "M": {
				cursor = { x: args[0] + ox, y: args[1] + oy };
				start = { ...cursor };
				begin({ ...cursor });
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			case "L": {
				cursor = { x: args[0] + ox, y: args[1] + oy };
				lineTo({ ...cursor });
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			case "H": {
				cursor = { x: args[0] + ox, y: cursor.y };
				lineTo({ ...cursor });
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			case "V": {
				cursor = { x: cursor.x, y: args[0] + oy };
				lineTo({ ...cursor });
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			case "C": {
				const c1 = { x: args[0] + ox, y: args[1] + oy };
				const c2 = { x: args[2] + ox, y: args[3] + oy };
				const end = { x: args[4] + ox, y: args[5] + oy };
				cubicTo(c1, c2, end);
				cursor = end;
				lastCubicControl = c2;
				lastQuadControl = null;
				break;
			}
			case "S": {
				const c1: Point = lastCubicControl
					? {
							x: 2 * cursor.x - lastCubicControl.x,
							y: 2 * cursor.y - lastCubicControl.y,
						}
					: { ...cursor };
				const c2 = { x: args[0] + ox, y: args[1] + oy };
				const end = { x: args[2] + ox, y: args[3] + oy };
				cubicTo(c1, c2, end);
				cursor = end;
				lastCubicControl = c2;
				lastQuadControl = null;
				break;
			}
			case "Q": {
				const c = { x: args[0] + ox, y: args[1] + oy };
				const end = { x: args[2] + ox, y: args[3] + oy };
				const [, c1, c2] = quadraticToCubic(cursor, c, end);
				cubicTo(c1, c2, end);
				cursor = end;
				lastQuadControl = c;
				lastCubicControl = null;
				break;
			}
			case "T": {
				const c: Point = lastQuadControl
					? {
							x: 2 * cursor.x - lastQuadControl.x,
							y: 2 * cursor.y - lastQuadControl.y,
						}
					: { ...cursor };
				const end = { x: args[0] + ox, y: args[1] + oy };
				const [, c1, c2] = quadraticToCubic(cursor, c, end);
				cubicTo(c1, c2, end);
				cursor = end;
				lastQuadControl = c;
				lastCubicControl = null;
				break;
			}
			case "A": {
				const end = { x: args[5] + ox, y: args[6] + oy };
				for (const [, c1, c2, to] of arcToCubics(
					cursor,
					args[0],
					args[1],
					args[2],
					args[3] !== 0,
					args[4] !== 0,
					end,
				)) {
					cubicTo(c1, c2, to);
					cursor = to;
				}
				cursor = end;
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			case "Z": {
				if (current) {
					(current as Subpath).closed = true;
					current = null;
				}
				cursor = { ...start };
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
		}
	}

	return subpaths
		.filter((sub) => sub.points.length > 1)
		.map((sub) =>
			sub.closed ? { ...sub, points: closePolyline(sub.points) } : sub,
		);
}

/**
 * Parses SVG path data into exact `CurvePath`s (the curve form of
 * {@link flattenPath}): every command, arcs included, becomes cubic segments.
 *
 * @param d - SVG path data string.
 * @returns One curve path per subpath.
 *
 * @category Paths
 */
export function pathDataToCurvePath(d: string): CurvePath[] {
	const curves: CurvePath[] = [];
	let current: CurvePath | null = null;
	let cursor: Point = { x: 0, y: 0 };
	let start: Point = { x: 0, y: 0 };
	// Reflection anchors for the smooth variants (`S`/`T`).
	let lastCubicControl: Point | null = null;
	let lastQuadControl: Point | null = null;

	const begin = (p: Point) => {
		current = { start: p, segments: [], closed: false };
		curves.push(current);
	};
	const lineTo = (p: Point) => {
		if (!current) begin({ ...cursor });
		if (current) current.segments.push(lineSegment(cursor, p));
	};
	const cubicTo = (c1: Point, c2: Point, end: Point) => {
		if (!current) begin({ ...cursor });
		current?.segments.push({ c1, c2, to: end });
	};

	for (const { command, args } of parsePathData(d)) {
		const relative = command === command.toLowerCase();
		const ox = relative ? cursor.x : 0;
		const oy = relative ? cursor.y : 0;

		switch (command.toUpperCase()) {
			case "M": {
				cursor = { x: args[0] + ox, y: args[1] + oy };
				start = { ...cursor };
				begin({ ...cursor });
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			case "L": {
				const to = { x: args[0] + ox, y: args[1] + oy };
				lineTo(to);
				cursor = to;
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			case "H": {
				const to = { x: args[0] + ox, y: cursor.y };
				lineTo(to);
				cursor = to;
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			case "V": {
				const to = { x: cursor.x, y: args[0] + oy };
				lineTo(to);
				cursor = to;
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			case "C": {
				const c1 = { x: args[0] + ox, y: args[1] + oy };
				const c2 = { x: args[2] + ox, y: args[3] + oy };
				const end = { x: args[4] + ox, y: args[5] + oy };
				cubicTo(c1, c2, end);
				cursor = end;
				lastCubicControl = c2;
				lastQuadControl = null;
				break;
			}
			case "S": {
				const c1: Point = lastCubicControl
					? {
							x: 2 * cursor.x - lastCubicControl.x,
							y: 2 * cursor.y - lastCubicControl.y,
						}
					: { ...cursor };
				const c2 = { x: args[0] + ox, y: args[1] + oy };
				const end = { x: args[2] + ox, y: args[3] + oy };
				cubicTo(c1, c2, end);
				cursor = end;
				lastCubicControl = c2;
				lastQuadControl = null;
				break;
			}
			case "Q": {
				const c = { x: args[0] + ox, y: args[1] + oy };
				const end = { x: args[2] + ox, y: args[3] + oy };
				const [, c1, c2] = quadraticToCubic(cursor, c, end);
				cubicTo(c1, c2, end);
				cursor = end;
				lastQuadControl = c;
				lastCubicControl = null;
				break;
			}
			case "T": {
				const c: Point = lastQuadControl
					? {
							x: 2 * cursor.x - lastQuadControl.x,
							y: 2 * cursor.y - lastQuadControl.y,
						}
					: { ...cursor };
				const end = { x: args[0] + ox, y: args[1] + oy };
				const [, c1, c2] = quadraticToCubic(cursor, c, end);
				cubicTo(c1, c2, end);
				cursor = end;
				lastQuadControl = c;
				lastCubicControl = null;
				break;
			}
			case "A": {
				const end = { x: args[5] + ox, y: args[6] + oy };
				for (const [, c1, c2, to] of arcToCubics(
					cursor,
					args[0],
					args[1],
					args[2],
					args[3] !== 0,
					args[4] !== 0,
					end,
				)) {
					cubicTo(c1, c2, to);
					cursor = to;
				}
				cursor = end;
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
			case "Z": {
				if (current) {
					(current as CurvePath).closed = true;
					current = null;
				}
				cursor = { ...start };
				lastCubicControl = null;
				lastQuadControl = null;
				break;
			}
		}
	}

	return curves.filter((curve) => curve.segments.length > 0);
}

/**
 * Repeats a polyline's first point at the end, if it isn't there already. Rings
 * are closed with real points so arc length, reveals and morphs count the last
 * edge.
 *
 * @param points - The polyline.
 * @returns `points` itself if already closed or shorter than 2 points, else a closed copy.
 *
 * @category Paths
 */
export function closePolyline(points: Polyline): Polyline {
	if (points.length < 2) return points;
	const first = points[0];
	const last = points[points.length - 1];
	if (first.x === last.x && first.y === last.y) return points;
	return [...points, { ...first }];
}

/**
 * Flattens a `CurvePath` into a single `Polyline`.
 *
 * @param curve - The curve path.
 * @param tolerance - Relative flatness budget.
 * @returns The flattened points; a closed curve gets its first point repeated.
 *
 * @category Paths
 */
export function curvePathToPolyline(
	curve: CurvePath,
	tolerance?: number,
): Polyline {
	const points: Polyline = [{ ...curve.start }];
	let cursor = curve.start;
	for (const segment of curve.segments) {
		const flattened = flattenCubicPolyline(
			cursor,
			segment.c1,
			segment.c2,
			segment.to,
			tolerance,
		);
		// A loop, not `push(...)`: a long segment can flatten past the
		// argument limit a spread throws at.
		for (let i = 1; i < flattened.length; i++) points.push(flattened[i]);
		cursor = segment.to;
	}
	return curve.closed ? closePolyline(points) : points;
}

/**
 * Wraps a polyline as a `CurvePath` of straight segments. A closed result does
 * not repeat the first point; the closing edge is implicit.
 *
 * @param points - Vertices, in order.
 * @param closed - Whether the path closes back to its first point.
 * @returns A curve path of straight segments.
 *
 * @category Paths
 */
export function polylineToCurvePath(
	points: Polyline,
	closed: boolean,
): CurvePath {
	if (points.length === 0)
		return { start: { x: 0, y: 0 }, segments: [], closed };
	const [start, ...rest] = points;
	const segments: CurveSegment[] = [];
	let cursor = start;
	for (const to of rest) {
		segments.push(lineSegment(cursor, to));
		cursor = to;
	}
	return {
		start: { ...start },
		segments,
		closed,
	};
}

/**
 * Serializes a polyline back to SVG path data, for an `<svg>` export or a `Path2D`.
 *
 * @param points - The polyline.
 * @param closed - Append `Z`. Defaults to false.
 * @returns `M x y L x y ...`, or an empty string for no points.
 *
 * @category Paths
 */
export function toPathData(points: Polyline, closed = false): string {
	if (points.length === 0) return "";
	const head = `M${points[0].x} ${points[0].y}`;
	const tail = points
		.slice(1)
		.map((p) => `L${p.x} ${p.y}`)
		.join("");
	return head + tail + (closed ? "Z" : "");
}
