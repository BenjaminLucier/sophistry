/**
 * `image`: a picture laid into a box, positioned by its centre like `rect`,
 * and `loadImage`, which decodes a file into the pixels it takes. How the
 * picture fills the box follows CSS's `object-fit`.
 */

import type { Point } from "../geometry/index.js";
import { Invalidate } from "../scene/context.js";
import type { ImageGeometry, ImageProps } from "../scene/marks.js";
import { defineImage, imageProps } from "../scene/marks.js";
import type { ImagePixels } from "../spec/types.js";

/**
 * How a picture fills its box: `"fill"` stretches it to the box,
 * `"contain"` fits it whole inside (leaving bands), `"cover"` fills the box
 * and crops what overflows.
 *
 * @category Shapes
 */
export type ObjectFit = "fill" | "contain" | "cover";

/** @category Shapes */
export interface ImageNodeProps extends ImageProps {
	/** The picture, from {@link loadImage}; `null` draws nothing. */
	pixels: ImagePixels | null;
	/** Centre in scene units. Defaults to the origin. */
	center?: Point;
	/** Width of the box in scene units. */
	width: number;
	/** Height of the box in scene units. Defaults to the picture's aspect ratio at `width`. */
	height?: number;
	/**
	 * How the picture fills the box.
	 * @default "contain"
	 */
	objectFit?: ObjectFit;
}

/**
 * Where a picture goes in a box: the part of the picture to draw (in
 * pixels) and the rectangle it is drawn into (relative to the box's centre).
 *
 * @category Shapes
 */
export interface ImageFit {
	/** The source rectangle, in pixels from the picture's top-left corner. */
	crop: { x: number; y: number; width: number; height: number };
	/** The drawn width. */
	width: number;
	/** The drawn height. */
	height: number;
}

/**
 * Fits a `pixelWidth` × `pixelHeight` picture into a `width` × `height` box.
 *
 * @param pixelWidth - The picture's width in pixels.
 * @param pixelHeight - The picture's height in pixels.
 * @param width - The box's width.
 * @param height - The box's height.
 * @param fit - How the picture fills the box.
 * @returns The source rectangle and the drawn size.
 *
 * @category Shapes
 */
export function fitImage(
	pixelWidth: number,
	pixelHeight: number,
	width: number,
	height: number,
	fit: ObjectFit,
): ImageFit {
	const whole = { x: 0, y: 0, width: pixelWidth, height: pixelHeight };
	if (fit === "fill" || pixelWidth <= 0 || pixelHeight <= 0) {
		return { crop: whole, width, height };
	}
	const scaleX = width / pixelWidth;
	const scaleY = height / pixelHeight;
	if (fit === "contain") {
		const scale = Math.min(scaleX, scaleY);
		return {
			crop: whole,
			width: pixelWidth * scale,
			height: pixelHeight * scale,
		};
	}
	// Cover: the largest centred part of the picture with the box's aspect.
	const scale = Math.max(scaleX, scaleY);
	const cropWidth = Math.min(pixelWidth, width / scale);
	const cropHeight = Math.min(pixelHeight, height / scale);
	return {
		crop: {
			x: (pixelWidth - cropWidth) / 2,
			y: (pixelHeight - cropHeight) / 2,
			width: cropWidth,
			height: cropHeight,
		},
		width,
		height,
	};
}

const EMPTY: ImagePixels = {
	width: 0,
	height: 0,
	data: new Uint8ClampedArray(0),
};

/** Crops already made, per source picture, so a crop is copied once. */
const crops = new WeakMap<ImagePixels, Map<string, ImagePixels>>();

/** The pixels inside `crop`, rounded to whole pixels; the source itself when the crop is all of it. */
function cropPixels(pixels: ImagePixels, crop: ImageFit["crop"]): ImagePixels {
	const x = Math.round(crop.x);
	const y = Math.round(crop.y);
	const width = Math.max(1, Math.round(crop.width));
	const height = Math.max(1, Math.round(crop.height));
	if (
		x === 0 &&
		y === 0 &&
		width === pixels.width &&
		height === pixels.height
	) {
		return pixels;
	}
	const key = `${x},${y},${width},${height}`;
	let cache = crops.get(pixels);
	const cached = cache?.get(key);
	if (cached) return cached;
	const data = new Uint8ClampedArray(width * height * 4);
	for (let row = 0; row < height; row++) {
		const from = ((y + row) * pixels.width + x) * 4;
		data.set(pixels.data.subarray(from, from + width * 4), row * width * 4);
	}
	const result = { width, height, data };
	if (!cache) {
		cache = new Map();
		crops.set(pixels, cache);
	}
	cache.set(key, result);
	return result;
}

/**
 * A picture in a box, centred on `center`. Load the pixels with
 * {@link loadImage}; until they arrive, `pixels: null` draws nothing. The
 * picture is upright on a y-up stage (the default).
 *
 * @example
 * ```ts
 * import { createScene, image, loadImage } from "@sophistry/core";
 *
 * const scene = createScene({ host: document.body });
 * const photo = scene.root.add(image.create({ pixels: null, width: 4, height: 3, objectFit: "cover" }));
 * loadImage("/photo.jpg").then((pixels) => photo.set("pixels", pixels));
 * ```
 *
 * @category Shapes
 */
export const image = defineImage<ImageNodeProps>({
	name: "Image",
	props: {
		...imageProps,
		pixels: { invalidates: Invalidate.GEOMETRY },
		center: { invalidates: Invalidate.GEOMETRY },
		width: { invalidates: Invalidate.GEOMETRY },
		height: { invalidates: Invalidate.GEOMETRY },
		objectFit: { default: "contain", invalidates: Invalidate.GEOMETRY },
	},
	image: (props): ImageGeometry => {
		const pixels = props.pixels;
		const center = props.center ?? { x: 0, y: 0 };
		if (!pixels || pixels.width === 0 || pixels.height === 0) {
			return {
				pixels: EMPTY,
				origin: center,
				xAxis: { x: 0, y: 0 },
				yAxis: { x: 0, y: 0 },
			};
		}
		const width = props.width;
		const height = props.height ?? (width * pixels.height) / pixels.width;
		const fit = fitImage(
			pixels.width,
			pixels.height,
			width,
			height,
			props.objectFit ?? "contain",
		);
		return {
			pixels: cropPixels(pixels, fit.crop),
			// Pixel row 0 is the top: on a y-up stage the frame runs downward.
			origin: { x: center.x - fit.width / 2, y: center.y + fit.height / 2 },
			xAxis: { x: fit.width, y: 0 },
			yAxis: { x: 0, y: -fit.height },
		};
	},
});

/**
 * Decodes a picture into the pixels {@link image} takes. Accepts a URL (fetched,
 * so cross-origin pictures need CORS) or a `Blob`. Needs a browser (or a
 * worker): it decodes with `createImageBitmap` and reads the pixels back
 * through a 2D canvas.
 *
 * @param source - A URL or a `Blob`.
 * @param options - `signal` aborts the fetch.
 * @returns The picture's pixels.
 *
 * @category Shapes
 */
export async function loadImage(
	source: string | Blob,
	options: { signal?: AbortSignal } = {},
): Promise<ImagePixels> {
	const blob =
		typeof source === "string"
			? await (await fetch(source, { signal: options.signal })).blob()
			: source;
	const bitmap = await createImageBitmap(blob);
	try {
		const { width, height } = bitmap;
		const canvas =
			typeof OffscreenCanvas === "function"
				? new OffscreenCanvas(width, height)
				: Object.assign(document.createElement("canvas"), { width, height });
		const context = canvas.getContext("2d") as
			| OffscreenCanvasRenderingContext2D
			| CanvasRenderingContext2D
			| null;
		if (!context) throw new Error("loadImage(): no 2D canvas to decode into");
		context.drawImage(bitmap, 0, 0);
		const { data } = context.getImageData(0, 0, width, height);
		return { width, height, data };
	} finally {
		bitmap.close();
	}
}
