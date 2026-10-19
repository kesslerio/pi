/** Limits an image the model sees must keep; the defaults below are the coding agent's. */
export type ImageLimits = {
	/** Pixels. Default 2000. */
	readonly maxWidth: number;
	/** Pixels. Default 2000. */
	readonly maxHeight: number;
	/** Bytes of base64. Default 4.5 MiB, below Anthropic's 5 MB. */
	readonly maxBytes: number;
};

export const DEFAULT_IMAGE_LIMITS: ImageLimits = { maxWidth: 2000, maxHeight: 2000, maxBytes: 4.5 * 1024 * 1024 };

/** An image the model can take: a supported format, within the limits, as base64. */
export type PreparedImage = {
	readonly data: string;
	readonly mimeType: string;
	/** Set when the image was resized: its size before and after, for the model to map coordinates back. */
	readonly resized?: {
		readonly from: { readonly width: number; readonly height: number };
		readonly to: { readonly width: number; readonly height: number };
	};
	/** The original format, set when it differs from `mimeType`: BMP becomes PNG, a large PNG may become JPEG. */
	readonly convertedFrom?: string;
};

/**
 * Decodes, orients, resizes, and re-encodes images so the model can take them. `read` uses one when given; without
 * one, it passes supported images within the byte limit through as they are. `@earendil-works/pi-durable/images`
 * provides a Photon-based one.
 */
export type ImageProcessor = {
	/**
	 * The image, prepared to fit `limits`, or `undefined` when it cannot be decoded or made to fit. A promise, so a
	 * processor can do the work off the event loop.
	 */
	prepare(bytes: Uint8Array, mimeType: string, limits: ImageLimits): Promise<PreparedImage | undefined>;
};

/** Formats every provider takes inline; others, such as BMP, need converting. */
export const INLINE_IMAGE_TYPES: ReadonlySet<string> = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

const BASE64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Standard base64 of `bytes`, using portable typed arrays and `TextDecoder` rather than `Buffer` or `btoa`. */
export function toBase64(bytes: Uint8Array): string {
	const parts: string[] = [];
	const chunk = new Uint8Array(8192);
	const decoder = new TextDecoder();
	let written = 0;
	for (let i = 0; i < bytes.length; i += 3) {
		const a = bytes[i]!;
		const b = bytes[i + 1];
		const c = bytes[i + 2];
		chunk[written++] = BASE64.charCodeAt(a >> 2);
		chunk[written++] = BASE64.charCodeAt(((a & 3) << 4) | ((b ?? 0) >> 4));
		chunk[written++] = b === undefined ? 61 : BASE64.charCodeAt(((b & 15) << 2) | ((c ?? 0) >> 6));
		chunk[written++] = c === undefined ? 61 : BASE64.charCodeAt(c & 63);
		// Flat ASCII chunks avoid allocating one string node per character and leaving a large GC pause afterward.
		if (written === chunk.length) {
			parts.push(decoder.decode(chunk));
			written = 0;
		}
	}
	if (written > 0) parts.push(decoder.decode(chunk.subarray(0, written)));
	return parts.join("");
}

/** The length of the base64 of `byteLength` bytes. */
export function base64Length(byteLength: number): number {
	return Math.ceil(byteLength / 3) * 4;
}
