import { describe, expect, expectTypeOf, it } from "vitest";
import {
	type Channel,
	channelValues,
	colorResolver,
	identity,
	indexOf,
	numberValues,
	type RequiredChannel,
	type RequiredUnless,
	resolveChannel,
	resolveColor,
	resolveQuantity,
} from "./channels.js";

interface Row {
	year: number;
	sales: number | null;
	name: string;
}
const rows: Row[] = [
	{ year: 2020, sales: 10, name: "a" },
	{ year: 2021, sales: null, name: "b" },
];

describe("resolveChannel", () => {
	it("reads a key of the datum", () => {
		const read = resolveChannel<Row, number>("year");
		expect(rows.map(read)).toEqual([2020, 2021]);
	});

	it("calls a function with the datum and its index", () => {
		const read = resolveChannel<Row, string>((d, i) => `${d.name}${i}`);
		expect(rows.map(read)).toEqual(["a0", "b1"]);
	});

	it("uses the fallback when the channel is omitted", () => {
		expect(resolveChannel<number, number>(undefined, identity)(7, 0)).toBe(7);
		expect(resolveChannel<number, number>(undefined, indexOf)(7, 3)).toBe(3);
	});

	it("throws a clear TypeError naming the prop for a non-channel value", () => {
		// e.g. `samples={64}` left over from the pre-channel ViolinPlot API.
		expect(() =>
			resolveChannel<Row, number>(64 as never, undefined, "samples"),
		).toThrow(/`samples` must be a key of the datum or a function.*number/);
		expect(() => resolveChannel<Row, number>([] as never)).toThrow(TypeError);
		expect(() => numberValues(rows, true as never, undefined, "value")).toThrow(
			/`value`/,
		);
	});

	it("resolves an omitted channel without a fallback to undefined", () => {
		expect(resolveChannel<Row, string>(undefined)).toBeUndefined();
	});
});

describe("channelValues / numberValues", () => {
	it("maps a channel across data", () => {
		expect(channelValues(rows, "name")).toEqual(["a", "b"]);
	});

	it("defaults number[] data to the datum itself", () => {
		expect(numberValues([3, 1, 4], undefined, identity)).toEqual([3, 1, 4]);
	});

	it("maps non-numbers (null, undefined) to NaN", () => {
		const values = numberValues(rows, "sales");
		expect(values[0]).toBe(10);
		expect(values[1]).toBeNaN();
	});

	it("is NaN for every datum without a channel or fallback", () => {
		expect(numberValues([1, 2], undefined).every(Number.isNaN)).toBe(true);
	});
});

describe("resolveQuantity", () => {
	it("treats a number as a constant for every datum", () => {
		const read = resolveQuantity<Row>(2);
		expect(rows.map(read)).toEqual([2, 2]);
	});

	it("treats a key or function as a per-datum channel", () => {
		expect(rows.map(resolveQuantity<Row>("year"))).toEqual([2020, 2021]);
		expect(rows.map(resolveQuantity<Row>((_, i) => i * 2))).toEqual([0, 2]);
	});

	it("falls back when omitted", () => {
		expect(resolveQuantity<Row>(undefined, () => 5)(rows[0], 0)).toBe(5);
		expect(resolveQuantity<Row>(undefined)).toBeUndefined();
	});
});

describe("colour channels", () => {
	const palette = ["red", "green"];

	it("cycles the palette by index when no colour is given", () => {
		const pick = colorResolver(undefined, palette, "black");
		expect([0, 1, 2].map((i) => pick(undefined, i))).toEqual([
			"red",
			"green",
			"red",
		]);
	});

	it("a constant colour wins over the palette", () => {
		const pick = colorResolver("blue", palette, "black");
		expect(pick(undefined, 1)).toBe("blue");
	});

	it("a function colour wins, and falls back to the palette on undefined", () => {
		const pick = colorResolver<number>(
			(d) => (d > 1 ? "gold" : (undefined as unknown as string)),
			palette,
			"black",
		);
		expect(pick(5, 0)).toBe("gold");
		expect(pick(0, 1)).toBe("green");
	});

	it("uses the fallback when the palette is empty", () => {
		expect(colorResolver(undefined, [], "black")(undefined, 0)).toBe("black");
	});

	it("never treats a string as a key", () => {
		expect(resolveColor<Row>("name")?.(rows[0], 0)).toBe("name");
		expect(resolveColor<Row>(undefined)).toBeUndefined();
	});
});

describe("RequiredUnless typing", () => {
	type Props<T> = {
		data: readonly T[];
		y?: Channel<T, number>;
	} & RequiredUnless<T, number, "y">;
	const take = <T>(_: Props<T>) => {};

	it("defaults the channel for number-like data, nullish members included", () => {
		take({ data: [1, 2] });
		take({ data: [1, undefined, null] as (number | null | undefined)[] });
		take({ data: [] as unknown as never[] });
		expect(true).toBe(true);
	});

	it("requires the channel otherwise, naming the channel type", () => {
		// @ts-expect-error `y` is required for records
		take({ data: rows });
		take({ data: rows, y: "year" });
		take({ data: rows, y: (d) => d.year });
		// @ts-expect-error `unknown` data is never guessed at
		take({ data: [] as unknown[] });
		expectTypeOf<RequiredUnless<Row, number, "y">>().toEqualTypeOf<{
			y: RequiredChannel<Row, number>;
		}>();
	});
});
