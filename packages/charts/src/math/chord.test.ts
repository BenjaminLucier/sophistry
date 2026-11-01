import { describe, expect, it } from "vitest";
import { chordLayout, chordRibbon } from "./chord.js";

const TAU = Math.PI * 2;
const sweep = (a: { startAngle: number; endAngle: number }) =>
	a.endAngle - a.startAngle;

const matrix = [
	[0, 5, 2],
	[3, 0, 1],
	[4, 2, 0],
];

describe("chordLayout", () => {
	it("sizes each group's arc by its row total, clockwise from 12 o'clock", () => {
		const { groups } = chordLayout(matrix, { padAngle: 0 });
		expect(groups.map((g) => g.value)).toEqual([7, 4, 6]);
		expect(groups[0].startAngle).toBeCloseTo(Math.PI / 2);
		// Clockwise: angles decrease.
		expect(sweep(groups[0])).toBeCloseTo((-TAU * 7) / 17);
		expect(sweep(groups[1])).toBeCloseTo((-TAU * 4) / 17);
		expect(groups[1].startAngle).toBeCloseTo(groups[0].endAngle);
		expect(groups[2].endAngle).toBeCloseTo(Math.PI / 2 - TAU);
	});

	it("leaves padAngle between groups and keeps the total a full turn", () => {
		const { groups } = chordLayout(matrix, { padAngle: 0.1 });
		const arcs = groups.reduce((s, g) => s + Math.abs(sweep(g)), 0);
		expect(arcs).toBeCloseTo(TAU - 0.3);
		expect(groups[1].startAngle).toBeCloseTo(groups[0].endAngle - 0.1);
	});

	it("joins i → j and j → i in one chord, the larger end as source", () => {
		const { chords } = chordLayout(matrix, { padAngle: 0 });
		expect(chords).toHaveLength(3);
		const [ab, ac, bc] = chords;
		expect([ab.source.index, ab.source.value]).toEqual([0, 5]);
		expect([ab.target.index, ab.target.value]).toEqual([1, 3]);
		// 2 → 0 (4) beats 0 → 2 (2).
		expect([ac.source.index, ac.target.index]).toEqual([2, 0]);
		expect([bc.source.index, bc.target.index]).toEqual([2, 1]);
		// Each end's arc is ∝ its flow, inside its group.
		const k = TAU / 17;
		expect(Math.abs(sweep(ab.source))).toBeCloseTo(5 * k);
		expect(Math.abs(sweep(ab.target))).toBeCloseTo(3 * k);
	});

	it("counter-clockwise and from another start when asked", () => {
		const { groups } = chordLayout(matrix, {
			padAngle: 0,
			startAngle: 0,
			clockwise: false,
		});
		expect(groups[0].startAngle).toBe(0);
		expect(sweep(groups[0])).toBeGreaterThan(0);
	});

	it("directed: one chord per flow, equal ends, sinks get arcs", () => {
		// 0 → 1 and 0 → 2 only: 1 and 2 receive but never send.
		const sinks = [
			[0, 3, 1],
			[0, 0, 0],
			[0, 0, 0],
		];
		const plain = chordLayout(sinks, { padAngle: 0 });
		expect(plain.groups.map((g) => g.value)).toEqual([4, 0, 0]);

		const { groups, chords } = chordLayout(sinks, {
			padAngle: 0,
			directed: true,
		});
		expect(groups.map((g) => g.value)).toEqual([4, 3, 1]);
		expect(chords).toHaveLength(2);
		for (const chord of chords) {
			expect(chord.source.index).toBe(0);
			expect(Math.abs(sweep(chord.source))).toBeCloseTo(
				Math.abs(sweep(chord.target)),
			);
			expect(chord.target.value).toBe(chord.source.value);
		}
		expect(chords[0].target.index).toBe(1);
		expect(chords[1].target.index).toBe(2);
	});

	it("ignores negative and non-finite flows; no flow draws nothing", () => {
		const { groups, chords } = chordLayout([
			[0, -2],
			[Number.NaN, 0],
		]);
		expect(chords).toEqual([]);
		expect(groups.every((g) => sweep(g) === 0)).toBe(true);
	});
});

describe("chordRibbon", () => {
	it("runs along both ends' arcs and curves through the middle", () => {
		const { chords } = chordLayout(matrix, { padAngle: 0 });
		const ring = chordRibbon(chords[0], 2, { center: { x: 1, y: -1 } });
		const radii = ring.map((p) => Math.hypot(p.x - 1, p.y + 1));
		// Arc points sit on the circle; curve points fall inside it.
		expect(Math.max(...radii)).toBeCloseTo(2);
		expect(Math.min(...radii)).toBeLessThan(1.5);
		const onCircle = radii.filter((r) => Math.abs(r - 2) < 1e-9).length;
		expect(onCircle).toBeGreaterThan(4);
		// Starts at the source's start, open ring.
		const s = chords[0].source.startAngle;
		expect(ring[0].x).toBeCloseTo(1 + 2 * Math.cos(s));
		expect(ring[0].y).toBeCloseTo(-1 + 2 * Math.sin(s));
	});

	it("headRadius turns the target end into an arrowhead on the circle", () => {
		const { chords } = chordLayout(matrix, { padAngle: 0, directed: true });
		const chord = chords[0];
		const ring = chordRibbon(chord, 2, { headRadius: 0.3, curveSamples: 6 });
		const radii = ring.map((p) => Math.hypot(p.x, p.y));
		const t = chord.target;
		const mid = (t.startAngle + t.endAngle) / 2;
		// The tip: on the circle, mid-way along the target end.
		const tooltip = ring.findIndex(
			(p) =>
				Math.abs(p.x - 2 * Math.cos(mid)) < 1e-9 &&
				Math.abs(p.y - 2 * Math.sin(mid)) < 1e-9,
		);
		expect(tooltip).toBeGreaterThan(0);
		// Flanked by the target end's corners, 0.3 short of the circle.
		expect(radii[tooltip - 1]).toBeCloseTo(1.7);
		expect(radii[tooltip + 1]).toBeCloseTo(1.7);
		const corner = ring[tooltip - 1];
		expect(Math.atan2(corner.y, corner.x)).toBeCloseTo(
			Math.atan2(Math.sin(t.startAngle), Math.cos(t.startAngle)),
		);
		// No point of the target end's arc sits on the circle: only the source's and the tip.
		const onCircle = ring.filter(
			(_, i) => Math.abs(radii[i] - 2) < 1e-9 && i !== tooltip,
		);
		const s = chord.source;
		for (const p of onCircle) {
			const angle = Math.atan2(p.y, p.x);
			const within = (a: number, lo: number, hi: number) =>
				a >= Math.min(lo, hi) - 1e-9 && a <= Math.max(lo, hi) + 1e-9;
			const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
			expect(
				within(angle, wrap(s.startAngle), wrap(s.endAngle)) ||
					within(angle + 2 * Math.PI, s.startAngle, s.endAngle) ||
					within(angle - 2 * Math.PI, s.startAngle, s.endAngle),
			).toBe(true);
		}
		// Without a head the plain ribbon is unchanged.
		expect(chordRibbon(chord, 2, { headRadius: 0 })).toEqual(
			chordRibbon(chord, 2),
		);
	});

	it("draws a self-chord as one arc and a loop through the centre", () => {
		const { chords } = chordLayout([[2]], { padAngle: 0 });
		const ring = chordRibbon(chords[0], 1, { curveSamples: 4 });
		// One arc (full turn) plus the 3 inner points of the closing curve.
		const arcPoints = ring.length - 3;
		expect(arcPoints).toBeGreaterThan(2);
	});
});
