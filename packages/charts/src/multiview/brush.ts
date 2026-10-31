/**
 * Gesture arithmetic behind `rangeBrush` and `chartZoom`: brush drags and
 * wheel resizes, and zoom, pan and box zoom over a chart's coordinate
 * system and range tracks. Components wire these to pointer, wheel and keys.
 *
 * The coordinate system is read through a getter on every gesture step: a
 * chart publishes a new one whenever its ranges change, so a gesture never
 * holds on to a stale one.
 */

import type {
	Animatable,
	CoordinateSystem,
	DragBehaviour,
	DragParam,
	Readable,
	SceneNodeWheelEvent,
	ScenePointerEvent,
} from "@sophistry/core";
import { draggable } from "@sophistry/core";
import type { Point } from "@sophistry/core/geometry";

/**
 * A number a `rangeBrush` or `chartZoom` reads and writes: a `track(...)`, or
 * any `Readable` with `set`.
 *
 * @category Charts
 */
export type BrushCell = Readable<number> & Animatable<number>;

/**
 * A drag-to-zoom rectangle, in the plot's local scene units: its two
 * corners and which axes it zooms (a thin box zooms only along its length).
 *
 * @category Charts
 */
export interface ChartZoomBox {
	a: Point;
	b: Point;
	x: boolean;
	y: boolean;
}

/** Where the coordinate system comes from: read on every use. */
type CoordsSource = () => CoordinateSystem;

/** CSS pixels a wheel `deltaMode` of lines or pages is worth, as `panZoom` reads them. */
export const WHEEL_LINE = 16;
export const WHEEL_PAGE = 400;
/** CSS pixels a press may move and still be a tap (the driver's slop). */
const TAP_SLOP = 8;

/** An axis of a chart, `"x"` or `"y"`. */
type Axis = "x" | "y";

/** One brushed axis: its two tracks and how they may move. */
export interface BrushAxis {
	axis: "x" | "y";
	from: BrushCell;
	to: BrushCell;
	bounds: () => readonly [number, number] | undefined;
	minSpan: () => number | undefined;
	/** Keep the ends on whole slots (a band axis). */
	snap: () => boolean;
}

/**
 * The rules one brushed axis's ends follow: where they may go, the
 * narrowest span, and snapping to whole categories.
 */
function brushRules(coords: CoordsSource, axis: BrushAxis) {
	const range = () =>
		axis.axis === "y" ? coords().yRange() : coords().xRange();
	const limits = (): [number, number] => {
		const [a, b] = axis.bounds() ?? range();
		const lo = Math.min(a, b);
		const hi = Math.max(a, b);
		// Whole slots only: a band axis's outer padding is no place to stop.
		return axis.snap()
			? [Math.ceil(lo - 1e-9), Math.floor(hi + 1e-9)]
			: [lo, hi];
	};
	const minSpan = () => {
		const given = axis.minSpan() ?? 0;
		return axis.snap() ? Math.max(1, Math.round(given)) : given;
	};
	/** `v` within `[lo, hi]`, `lo` winning when `hi < lo`. */
	const clamp = (v: number, lo: number, hi: number) =>
		Math.min(Math.max(v, lo), Math.max(lo, hi));
	/** A proposed end, settled: on a whole slot when snapping; a key press (pointer id -1) moves at least one slot. */
	const settle = (raw: number, origin: number, event: ScenePointerEvent) => {
		if (!axis.snap()) return raw;
		if (event.pointerId === -1 && Math.abs(raw - origin) > 1e-9) {
			const step = Math.max(1, Math.round(Math.abs(raw - origin)));
			return origin + Math.sign(raw - origin) * step;
		}
		return Math.round(raw);
	};
	const valueAt = (p: Point) => {
		const data = coords().pointToCoords(p);
		return axis.axis === "y" ? data.y : data.x;
	};
	/** A value's drawn position along the axis, in scene units. */
	const position = (v: number) => {
		const crossing = coords().crossing();
		return axis.axis === "y"
			? coords().coordsToPoint(crossing.x, v).y
			: coords().coordsToPoint(v, crossing.y).x;
	};
	/** The value drawn at a position along the axis. */
	const valueAtPosition = (at: number) => {
		const area = coords().area();
		return valueAt(
			axis.axis === "y"
				? { x: (area.minX + area.maxX) / 2, y: at }
				: { x: at, y: (area.minY + area.maxY) / 2 },
		);
	};
	/**
	 * The body moved so its `from` end is at `raw`, keeping the span (in drawn
	 * positions, so by ratio on a log axis) inside the limits. Snapped axes and
	 * ends with no drawn position keep the value span.
	 */
	const slide = (raw: number): [number, number] => {
		const from = axis.from.peek();
		const to = axis.to.peek();
		const [lo, hi] = limits();
		const pf = position(from);
		const pt = position(to);
		const pr = position(raw);
		const plo = position(lo);
		const phi = position(hi);
		const drawn =
			!axis.snap() &&
			[pf, pt, pr, plo, phi].every(Number.isFinite) &&
			plo !== phi;
		// Everything in one space: drawn positions where the scale gives them,
		// else values.
		const [sf, st, sr, s0, s1] = drawn
			? [pf, pt, pr, plo, phi]
			: [from, to, raw, lo, hi];
		const w = st - sf;
		const low = Math.min(s0, s1) - Math.min(0, w);
		const high = Math.max(s0, s1) - Math.max(0, w);
		const s = clamp(sr, low, high);
		const at = (q: number) => {
			// A limit met lands on it exactly.
			if (Math.abs(q - s0) < 1e-9) return lo;
			if (Math.abs(q - s1) < 1e-9) return hi;
			return drawn ? valueAtPosition(q) : q;
		};
		return [s === sr ? raw : at(s), at(s + w)];
	};
	return { limits, minSpan, clamp, settle, valueAt, slide };
}

/**
 * The wheel on a `rangeBrush`: grows or shrinks its span about the
 * cursor on every brushed axis (geometrically on a log axis), within the
 * limits and `minSpan`; a snapped axis moves a whole slot once the resize
 * accumulates. Returns whether the wheel was taken.
 *
 * @internal
 */
export function brushWheel(options: {
	coords: CoordsSource;
	axes: readonly BrushAxis[];
	speed?: () => number;
}) {
	const { coords } = options;
	const all = options.axes.map((axis) => ({
		axis,
		rules: brushRules(coords, axis),
		/** The resize a snapped axis has not shown yet, and the ends it applies to. */
		pending: { factor: 1, from: Number.NaN, to: Number.NaN },
	}));
	const position = (axis: "x" | "y", value: number) => {
		const crossing = coords().crossing();
		return axis === "x"
			? coords().coordsToPoint(value, crossing.y).x
			: coords().coordsToPoint(crossing.x, value).y;
	};
	const valueAt = (axis: "x" | "y", at: number) => {
		const area = coords().area();
		const data = coords().pointToCoords(
			axis === "x"
				? { x: at, y: (area.minY + area.maxY) / 2 }
				: { x: (area.minX + area.maxX) / 2, y: at },
		);
		return axis === "x" ? data.x : data.y;
	};
	return (event: SceneNodeWheelEvent): boolean => {
		const native = event.native;
		const unit =
			native.deltaMode === 1
				? WHEEL_LINE
				: native.deltaMode === 2
					? WHEEL_PAGE
					: 1;
		const dy = native.deltaY * unit;
		if (dy === 0) return true;
		// A pinch's deltas are a few units a step where a mouse notch is ~100.
		const rate = native.ctrlKey ? 0.01 : 0.002;
		const step = Math.exp(dy * rate * (options.speed?.() ?? 1));
		for (const { axis, rules, pending } of all) {
			const from = axis.from.peek();
			const to = axis.to.peek();
			const snap = axis.snap();
			if (pending.from !== from || pending.to !== to) pending.factor = 1;
			const factor = snap ? pending.factor * step : step;
			const pivot = event.local[axis.axis];
			const end = (value: number) =>
				valueAt(
					axis.axis,
					pivot + (position(axis.axis, value) - pivot) * factor,
				);
			let a = end(from);
			let b = end(to);
			if (!Number.isFinite(a) || !Number.isFinite(b)) continue;
			const [lo, hi] = rules.limits();
			const min = rules.minSpan();
			if (Math.abs(b - a) < min) {
				// Out to `minSpan` about the value under the cursor, inside the limits.
				const at = Math.min(Math.max(valueAt(axis.axis, pivot), lo), hi);
				const sign = Math.sign(b - a) || Math.sign(to - from) || 1;
				a = at - (sign * min) / 2;
				b = at + (sign * min) / 2;
				const slide =
					Math.min(a, b) < lo
						? lo - Math.min(a, b)
						: Math.max(a, b) > hi
							? hi - Math.max(a, b)
							: 0;
				a += slide;
				b += slide;
			}
			a = Math.min(Math.max(a, lo), hi);
			b = Math.min(Math.max(b, lo), hi);
			if (snap) {
				a = Math.round(a);
				b = Math.round(b);
				if (Math.abs(b - a) < min - 1e-9) {
					// Rounded below the narrowest: keep what there was, and stop
					// winding the wheel up against it.
					pending.factor = 1;
					continue;
				}
				if (a === from && b === to) {
					// Not a whole slot yet: keep the resize for the next notch, but
					// only so much of it, so a brush pinned at its limits answers a
					// turn back at once.
					pending.factor = Math.min(4, Math.max(1 / 4, factor));
					pending.from = from;
					pending.to = to;
					continue;
				}
				pending.factor = 1;
			}
			if (a !== from) axis.from.set(a);
			if (b !== to) axis.to.set(b);
			pending.from = axis.from.peek();
			pending.to = axis.to.peek();
		}
		return true;
	};
}

/**
 * The gestures of a one-axis `rangeBrush`: the body (keeping the span)
 * and each edge, clamped to the bounds and snapped with `snap`.
 *
 * @internal
 */
export function brushDrags(options: {
	coords: CoordsSource;
	from: BrushCell;
	to: BrushCell;
	vertical: () => boolean;
	bounds: () => readonly [number, number] | undefined;
	minSpan: () => number | undefined;
	snap?: () => boolean;
	disabled: () => boolean;
}) {
	const { coords, vertical } = options;
	const axis: BrushAxis = {
		get axis() {
			return vertical() ? "y" : "x";
		},
		from: options.from,
		to: options.to,
		bounds: options.bounds,
		minSpan: options.minSpan,
		snap: options.snap ?? (() => false),
	};
	const rules = brushRules(coords, axis);
	/** A data value along the axis → a point in the frame. */
	const pointAt = (v: number): Point =>
		vertical()
			? coords().coordsToPoint(coords().crossing().x, v)
			: coords().coordsToPoint(v, coords().crossing().y);
	const param = (low: () => number, high: () => number): DragParam<number> => ({
		toPoint: pointAt,
		toValue: (at, ctx) =>
			rules.clamp(
				rules.settle(rules.valueAt(at), ctx.origin, ctx.event),
				low(),
				high(),
			),
	});
	/** The body moves both ends together, keeping the span (by ratio on a log axis), inside the limits. */
	const body: Animatable<number> = {
		peek: () => options.from.peek(),
		set(value) {
			const [from, to] = rules.slide(value);
			options.from.set(from);
			options.to.set(to);
		},
	};
	const constrain = () => (vertical() ? "axisY" : "axisX");
	const cursor = () => (vertical() ? "ns-resize" : "ew-resize");
	const drag = {
		body: draggable(body, {
			param: {
				toPoint: pointAt,
				toValue: (at, ctx) =>
					rules.slide(
						rules.settle(rules.valueAt(at), ctx.origin, ctx.event),
					)[0],
			},
			constrain: constrain(),
			disabled: options.disabled,
		}),
		from: draggable(options.from, {
			param: param(
				() => rules.limits()[0],
				() => options.to.peek() - rules.minSpan(),
			),
			constrain: constrain(),
			cursor: cursor(),
			activeCursor: cursor(),
			disabled: options.disabled,
		}),
		to: draggable(options.to, {
			param: param(
				() => options.from.peek() + rules.minSpan(),
				() => rules.limits()[1],
			),
			constrain: constrain(),
			cursor: cursor(),
			activeCursor: cursor(),
			disabled: options.disabled,
		}),
	};

	return { pointAt, drag };
}

/**
 * The gestures of a box `rangeBrush`: the body, the four edges and
 * the four corners.
 *
 * @internal
 */
export function boxBrushDrags(options: {
	coords: CoordsSource;
	x: BrushAxis;
	y: BrushAxis;
	disabled: () => boolean;
}) {
	const { coords, x, y, disabled } = options;
	const rx = brushRules(coords, x);
	const ry = brushRules(coords, y);
	const toPoint = (v: Point) => coords().coordsToPoint(v.x, v.y);
	/** One axis's end: kept between its limits, or short of the other end by `minSpan`. */
	const endRange = (
		rules: ReturnType<typeof brushRules>,
		axis: BrushAxis,
		end: "from" | "to",
	): [number, number] =>
		end === "from"
			? [rules.limits()[0], axis.to.peek() - rules.minSpan()]
			: [axis.from.peek() + rules.minSpan(), rules.limits()[1]];
	const settled = (
		rules: ReturnType<typeof brushRules>,
		raw: number,
		origin: number,
		event: ScenePointerEvent,
		[lo, hi]: [number, number],
	) => rules.clamp(rules.settle(raw, origin, event), lo, hi);

	/** Both axes' ends together, each keeping its span (by ratio on a log axis). */
	const body: Animatable<Point> = {
		peek: () => ({ x: x.from.peek(), y: y.from.peek() }),
		set(value) {
			const [x0, x1] = rx.slide(value.x);
			const [y0, y1] = ry.slide(value.y);
			x.from.set(x0);
			x.to.set(x1);
			y.from.set(y0);
			y.to.set(y1);
		},
	};
	const bodyParam: DragParam<Point> = {
		toPoint,
		toValue(at, ctx) {
			const data = coords().pointToCoords(at);
			return {
				x: rx.slide(rx.settle(data.x, ctx.origin.x, ctx.event))[0],
				y: ry.slide(ry.settle(data.y, ctx.origin.y, ctx.event))[0],
			};
		},
	};
	/** One end of one axis, dragged along that axis only. */
	const edge = (axis: BrushAxis, end: "from" | "to") => {
		const rules = axis === x ? rx : ry;
		const vertical = axis === y;
		const cursor = vertical ? "ns-resize" : "ew-resize";
		return draggable(axis[end], {
			param: {
				toPoint: (v) =>
					vertical
						? coords().coordsToPoint(x.from.peek(), v)
						: coords().coordsToPoint(v, y.from.peek()),
				toValue: (at, ctx) =>
					settled(
						rules,
						rules.valueAt(at),
						ctx.origin,
						ctx.event,
						endRange(rules, axis, end),
					),
			},
			constrain: vertical ? "axisY" : "axisX",
			cursor,
			activeCursor: cursor,
			disabled,
		});
	};
	/** A corner: one end of each axis, moving together. */
	const corner = (xEnd: "from" | "to", yEnd: "from" | "to") => {
		const cell: Animatable<Point> = {
			peek: () => ({ x: x[xEnd].peek(), y: y[yEnd].peek() }),
			set(value) {
				x[xEnd].set(value.x);
				y[yEnd].set(value.y);
			},
		};
		return {
			x: xEnd === "from" ? ("a" as const) : ("b" as const),
			y: yEnd === "from" ? ("a" as const) : ("b" as const),
			drag: draggable(cell, {
				param: {
					toPoint,
					toValue(at, ctx) {
						const data = coords().pointToCoords(at);
						return {
							x: settled(
								rx,
								data.x,
								ctx.origin.x,
								ctx.event,
								endRange(rx, x, xEnd),
							),
							y: settled(
								ry,
								data.y,
								ctx.origin.y,
								ctx.event,
								endRange(ry, y, yEnd),
							),
						};
					},
				},
				cursor: "move",
				activeCursor: "move",
				disabled,
			}),
		};
	};
	return {
		body: draggable(body, { param: bodyParam, disabled }),
		x: { from: edge(x, "from"), to: edge(x, "to") },
		y: { from: edge(y, "from"), to: edge(y, "to") },
		corners: [
			corner("from", "from"),
			corner("to", "from"),
			corner("from", "to"),
			corner("to", "to"),
		],
	};
}

/**
 * Zoom and pan over a chart's coordinate system and range tracks, as
 * `chartZoom` wires them to pointer, wheel and keys. Positions are in
 * the plot's local scene units.
 *
 * @internal
 */
export function chartZoomActions(options: {
	coords: CoordsSource;
	x?: readonly [BrushCell, BrushCell];
	y?: readonly [BrushCell, BrushCell];
	bounds: (axis: Axis) => readonly [number, number] | undefined;
	minSpan: (axis: Axis) => number | undefined;
	/** Whether an axis settles on whole slots (a band axis). Defaults to never. */
	snap?: (axis: Axis) => boolean;
}) {
	const { coords } = options;
	const axes = (["x", "y"] as const).flatMap((axis) => {
		const cells = options[axis];
		return cells ? [{ axis, cells }] : [];
	});
	const snapped = (axis: Axis) => options.snap?.(axis) ?? false;
	/** A value's drawn position along an axis, in scene units. */
	const position = (axis: Axis, value: number) => {
		const crossing = coords().crossing();
		const p =
			axis === "x"
				? coords().coordsToPoint(value, crossing.y)
				: coords().coordsToPoint(crossing.x, value);
		return axis === "x" ? p.x : p.y;
	};
	/** The value drawn at a position along an axis. */
	const valueAt = (axis: Axis, at: number) => {
		const area = coords().area();
		const p =
			axis === "x"
				? { x: at, y: (area.minY + area.maxY) / 2 }
				: { x: (area.minX + area.maxX) / 2, y: at };
		const data = coords().pointToCoords(p);
		return axis === "x" ? data.x : data.y;
	};
	/**
	 * How the tracks' own view maps an axis (their ends at the plot's edges,
	 * `coords`' scale between), so two writes before a frame compose instead
	 * of the second reading a stale view.
	 */
	const viewOf = (axis: Axis, cells: readonly [BrushCell, BrushCell]) => {
		const range = axis === "x" ? coords().xRange() : coords().yRange();
		// Where the frame draws its low and high values: a reversed axis
		// gives its range as it is drawn, so match the tracks' ends by value.
		const low = position(axis, Math.min(range[0], range[1]));
		const high = position(axis, Math.max(range[0], range[1]));
		const a = cells[0].peek();
		const b = cells[1].peek();
		const [ea, eb] = a <= b ? [low, high] : [high, low];
		const pa = position(axis, a);
		const pb = position(axis, b);
		const k = pb !== pa ? (eb - ea) / (pb - pa) : 1;
		return {
			at: (value: number) => ea + (position(axis, value) - pa) * k,
			value: (at: number) => valueAt(axis, pa + (at - ea) / k),
		};
	};
	/**
	 * Slides `[a, b]` inside `bounds`, or makes it the bounds when wider,
	 * measured in drawn positions (decades on a log axis); falls back to values
	 * where a bound has no position.
	 */
	const clampToBounds = (
		axis: Axis,
		[a, b]: [number, number],
		bounds: readonly [number, number],
	): [number, number] => {
		const lo = Math.min(bounds[0], bounds[1]);
		const hi = Math.max(bounds[0], bounds[1]);
		const pa = position(axis, a);
		const pb = position(axis, b);
		const plo = position(axis, lo);
		const phi = position(axis, hi);
		const drawn = [pa, pb, plo, phi].every(Number.isFinite) && plo !== phi;
		// Everything in one space: positions where the scale gives them, else values.
		const [sa, sb, s0, s1] = drawn ? [pa, pb, plo, phi] : [a, b, lo, hi];
		const minS = Math.min(s0, s1);
		const maxS = Math.max(s0, s1);
		const low = Math.min(sa, sb);
		const high = Math.max(sa, sb);
		/** The bound drawn at the low (or high) end of that space. */
		const boundAt = (end: number) =>
			end === minS ? (s0 <= s1 ? lo : hi) : s0 <= s1 ? hi : lo;
		if (high - low >= maxS - minS - 1e-12) {
			// Wider than the bounds: the bounds, in the range's own order.
			return a <= b ? [lo, hi] : [hi, lo];
		}
		let shift = 0;
		if (low < minS) shift = minS - low;
		else if (high > maxS) shift = maxS - high;
		if (shift === 0) return [a, b];
		const moved = (s: number, v: number) => {
			const to = s + shift;
			// The end that met the bound lands on it exactly.
			if (Math.abs(to - minS) < 1e-12) return boundAt(minS);
			if (Math.abs(to - maxS) < 1e-12) return boundAt(maxS);
			return drawn ? valueAt(axis, to) : v + shift;
		};
		return [moved(sa, a), moved(sb, b)];
	};
	/**
	 * Writes an axis's new ends: narrower than its bounds, wider than `minSpan`
	 * (about `pivot`) and slid inside them. Non-finite or crossed ends are
	 * dropped; `whole` puts them on whole slots.
	 */
	const write = (
		axis: Axis,
		cells: readonly [BrushCell, BrushCell],
		ends: [number, number],
		pivot: number,
		whole = false,
	) => {
		let [a, b] = ends;
		if (!Number.isFinite(a) || !Number.isFinite(b)) return;
		const before = cells[1].peek() - cells[0].peek();
		if (before !== 0 && Math.sign(b - a) !== Math.sign(before)) return;
		const min = options.minSpan(axis);
		const span = Math.abs(b - a);
		if (min !== undefined && min > 0 && span < min) {
			const k = min / (span || 1);
			if (span === 0) {
				a = pivot - (Math.sign(before) * min) / 2;
				b = pivot + (Math.sign(before) * min) / 2;
			} else {
				a = pivot + (a - pivot) * k;
				b = pivot + (b - pivot) * k;
			}
			if (whole) {
				// Whole slots, still at least `min` wide.
				const sign = Math.sign(b - a) || 1;
				a = Math.round(a);
				b = a + sign * Math.max(Math.ceil(min - 1e-9), 1);
			}
		}
		const bounds = options.bounds(axis);
		if (bounds) [a, b] = clampToBounds(axis, [a, b], bounds);
		if (whole) {
			a = Math.round(a) + 0;
			b = Math.round(b) + 0;
		}
		if (cells[0].peek() !== a) cells[0].set(a);
		if (cells[1].peek() !== b) cells[1].set(b);
	};
	/** Scales the content by `1 / factor` about `at` (below 1 zooms in), then slides it by `by`, in one write. */
	const transform = (at: Point, factor: number, by: Point) => {
		if (!(factor > 0) || !Number.isFinite(factor)) return;
		for (const { axis, cells } of axes) {
			const pivot = axis === "x" ? at.x : at.y;
			const d = axis === "x" ? by.x : by.y;
			if (factor === 1 && d === 0) continue;
			const view = viewOf(axis, cells);
			const ends = cells.map((cell) => {
				const p = view.at(cell.peek());
				return view.value(pivot + (p - d - pivot) * factor);
			}) as [number, number];
			write(axis, cells, ends, view.value(pivot - d));
		}
	};
	/** Zooms by `factor` (below 1 is in) about a point, which stays where it is. */
	const zoomAbout = (at: Point, factor: number) =>
		transform(at, factor, { x: 0, y: 0 });
	/** Slides the content by `by`: what was drawn at its tail is drawn at its head. */
	const panBy = (by: Point) => transform(centre(), 1, by);
	/** Zooms into a rectangle given by two scene-unit corners. Returns whether anything changed. */
	const zoomTo = (box: ChartZoomBox) => {
		const before = snapshot();
		for (const { axis, cells } of axes) {
			if (!box[axis]) continue;
			const view = viewOf(axis, cells);
			const u = view.value(box.a[axis]);
			const v = view.value(box.b[axis]);
			if (!Number.isFinite(u) || !Number.isFinite(v) || u === v) continue;
			const ascending = cells[1].peek() >= cells[0].peek();
			const lo = Math.min(u, v);
			const hi = Math.max(u, v);
			const ends: [number, number] = ascending ? [lo, hi] : [hi, lo];
			const whole = snapped(axis);
			write(
				axis,
				cells,
				whole ? [Math.round(ends[0]), Math.round(ends[1])] : ends,
				(u + v) / 2,
				whole,
			);
		}
		return snapshot().some((value, i) => value !== before[i]);
	};
	/**
	 * Puts snapped (band) axes on whole slots after a gesture that began at
	 * `origin`: `"slide"` keeps the span (a pan), `"ends"` rounds each end (a
	 * zoom). A key-press `step` moves at least one slot, `"in"` or `"out"`.
	 */
	const settle = (
		origin: readonly number[],
		how: "slide" | "ends",
		step: boolean | "in" | "out" = false,
	) => {
		let i = 0;
		for (const { axis, cells } of axes) {
			const o0 = origin[i++] ?? cells[0].peek();
			const o1 = origin[i++] ?? cells[1].peek();
			if (!snapped(axis)) continue;
			let a = cells[0].peek();
			let b = cells[1].peek();
			const sign = Math.sign(b - a) || Math.sign(o1 - o0) || 1;
			/** At least one slot from `origin` when a key moved it at all. */
			const away = (value: number, from: number) => {
				const d = value - from;
				if (!step || Math.abs(d) < 1e-9) return Math.round(value);
				return (
					Math.round(from) + Math.sign(d) * Math.max(1, Math.round(Math.abs(d)))
				);
			};
			if (how === "slide") {
				const span = sign * Math.max(1, Math.round(Math.abs(b - a)));
				a = away(a, o0);
				b = a + span;
			} else {
				const was = Math.abs(o1 - o0);
				a = Math.round(a);
				b = Math.round(b);
				if (step && Math.abs(Math.abs(b - a) - Math.round(was)) < 1e-9) {
					// A key zoom that rounded back: one slot in or out, about the
					// middle (the bounds and minSpan still have their say).
					const grow =
						step === "out" ||
						(step === true &&
							Math.abs(cells[1].peek() - cells[0].peek()) > was);
					const span = Math.max(1, Math.round(was) + (grow ? 1 : -1));
					const mid = (o0 + o1) / 2;
					a = Math.round(mid - (sign * span) / 2);
					b = a + sign * span;
				}
				if (Math.abs(b - a) < 1) b = a + sign;
			}
			write(axis, cells, [a, b], (a + b) / 2, true);
		}
	};
	/** Back to the bounds, on the axes that have them. */
	const reset = () => {
		let any = false;
		for (const { axis, cells } of axes) {
			const bounds = options.bounds(axis);
			if (!bounds) continue;
			any = true;
			const [lo, hi] = [Math.min(...bounds), Math.max(...bounds)];
			const ascending = cells[1].peek() >= cells[0].peek();
			cells[0].set(ascending ? lo : hi);
			cells[1].set(ascending ? hi : lo);
		}
		return any;
	};
	/** The middle of the plot, in scene units. */
	const centre = (): Point => {
		const area = coords().area();
		return { x: (area.minX + area.maxX) / 2, y: (area.minY + area.maxY) / 2 };
	};
	/** One axis's mapping: the tracks' view when it zooms, else the frame's. */
	const mapping = (axis: Axis) => {
		const cells = options[axis];
		return cells
			? viewOf(axis, cells)
			: {
					at: (v: number) => position(axis, v),
					value: (at: number) => valueAt(axis, at),
				};
	};
	/** Where a value pair is drawn — what a grab holds on to. */
	const pointOf = (value: { x: number; y: number }): Point => ({
		x: mapping("x").at(value.x),
		y: mapping("y").at(value.y),
	});
	/** The value pair drawn at a point. */
	const dataAt = (at: Point) => ({
		x: mapping("x").value(at.x),
		y: mapping("y").value(at.y),
	});
	/** Every track's value, to put back after a cancelled gesture. */
	const snapshot = () =>
		axes.flatMap(({ cells }) => cells.map((cell) => cell.peek()));
	const restore = (values: readonly number[]) => {
		let i = 0;
		for (const { cells } of axes)
			for (const cell of cells) {
				const value = values[i++];
				if (value !== undefined && cell.peek() !== value) cell.set(value);
			}
	};
	return {
		/** Which axes zoom. */
		has: (axis: Axis) => options[axis] !== undefined,
		transform,
		zoomAbout,
		panBy,
		zoomTo,
		settle,
		reset,
		centre,
		pointOf,
		dataAt,
		snapshot,
		restore,
	};
}

/**
 * The pointer gestures of a `chartZoom`: one finger or the mouse
 * pans, two fingers pinch-zoom; with `box`, the drag draws a rectangle and
 * the release zooms into it. A still press stays a tap; a cancelled gesture
 * puts the ranges back.
 *
 * @internal
 */
export function chartZoomDrag(
	actions: ReturnType<typeof chartZoomActions>,
	enabled: () => boolean,
	options: {
		/** Whether this press draws a zoom box rather than panning. */
		box?: (event: ScenePointerEvent) => boolean;
		/** The box as it is drawn, or null when it is gone. */
		onBox?: (box: ChartZoomBox | null) => void;
		/** A box zoom happened; `before` is the ranges it replaced (a {@link chartZoomActions} snapshot). */
		onZoom?: (before: number[]) => void;
		/** Whether one finger pans (a box can still be drawn without). Defaults to `enabled`. */
		pan?: () => boolean;
	} = {},
): DragBehaviour {
	/** Each finger's latest position, in the plot's units, and where it went down (CSS pixels). */
	const fingers = new Map<number, { at: Point; client: Point }>();
	let grabbed: { x: number; y: number } | null = null;
	let origin: number[] | null = null;
	let moved = false;
	/** This gesture draws a box: its first corner, in the plot's units and in CSS pixels. */
	let boxing: { at: Point; client: Point } | null = null;
	let box: ChartZoomBox | null = null;
	let pinched = false;
	const pans = () => options.pan?.() ?? true;
	const clientOf = (event: ScenePointerEvent): Point => ({
		x: event.native.clientX ?? 0,
		y: event.native.clientY ?? 0,
	});
	const setBox = (next: ChartZoomBox | null) => {
		box = next;
		options.onBox?.(next);
	};
	/** The first two fingers' spread and middle. */
	const pair = () => {
		const [a, b] = [...fingers.values()].map((f) => f.at);
		return {
			distance: Math.hypot(b.x - a.x, b.y - a.y),
			middle: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
		};
	};
	return {
		start(event) {
			if (!enabled()) return false;
			if (fingers.size >= 2) return false;
			if (fingers.size === 0) {
				const drawsBox = options.box?.(event) ?? false;
				if (!drawsBox && !pans()) return false;
				origin = actions.snapshot();
				moved = false;
				pinched = false;
				boxing = drawsBox ? { at: event.local, client: clientOf(event) } : null;
			} else if (boxing) {
				// A second finger turns a box into a pinch.
				boxing = null;
				setBox(null);
			}
			fingers.set(event.pointerId, {
				at: event.local,
				client: clientOf(event),
			});
			grabbed =
				fingers.size === 1 && !boxing ? actions.dataAt(event.local) : null;
			return true;
		},
		move(event) {
			const finger = fingers.get(event.pointerId);
			if (!finger) return;
			const client = clientOf(event);
			if (!moved) {
				const far = Math.hypot(
					client.x - finger.client.x,
					client.y - finger.client.y,
				);
				if (far <= TAP_SLOP) return;
				moved = true;
			}
			if (boxing) {
				finger.at = event.local;
				// A box thinner than a tap's slop zooms along its length only.
				const wide = Math.abs(client.x - boxing.client.x) > TAP_SLOP;
				const tall = Math.abs(client.y - boxing.client.y) > TAP_SLOP;
				const both = actions.has("x") && actions.has("y");
				setBox({
					a: boxing.at,
					b: event.local,
					x: actions.has("x") && (!both || wide || !tall),
					y: actions.has("y") && (!both || tall || !wide),
				});
				return;
			}
			if (fingers.size >= 2) {
				pinched = true;
				const before = pair();
				finger.at = event.local;
				const after = pair();
				// Spread zooms about the old middle, and the middle's move pans.
				actions.transform(
					before.middle,
					before.distance > 0 && after.distance > 0
						? before.distance / after.distance
						: 1,
					{
						x: after.middle.x - before.middle.x,
						y: after.middle.y - before.middle.y,
					},
				);
				return;
			}
			finger.at = event.local;
			if (!pans()) return;
			if (!grabbed) grabbed = actions.dataAt(event.local);
			// Grab the data: slide it so the grabbed value is back under the
			// pointer. Anchored, so it never drifts.
			const held = actions.pointOf(grabbed);
			actions.panBy({ x: event.local.x - held.x, y: event.local.y - held.y });
		},
		end(event, cancelled) {
			if (!fingers.delete(event.pointerId)) return;
			const wasDrag = moved;
			const wasBox = boxing !== null;
			if (boxing) {
				const drawn = box;
				boxing = null;
				setBox(null);
				if (!cancelled && drawn && origin) {
					const before = origin;
					if (actions.zoomTo(drawn)) options.onZoom?.(before);
				}
			} else if (cancelled && origin && moved) actions.restore(origin);
			// A finger lifting out of a pinch: the other re-grabs what it is over.
			const [rest] = [...fingers.values()];
			grabbed = rest ? actions.dataAt(rest.at) : null;
			if (fingers.size === 0) {
				// A box settled as it zoomed; a pan or a pinch settles now.
				if (!cancelled && moved && origin && !wasBox)
					actions.settle(origin, pinched ? "ends" : "slide");
				origin = null;
				moved = false;
				pinched = false;
			}
			return wasDrag;
		},
	};
}
