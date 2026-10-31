/**
 * The library's one notion of "movement that counts", in CSS pixels.
 *
 * A press that travels no further than this is still a tap; one that travels
 * further is a drag. The pointer driver uses it as its default `slop`, and
 * `draggable` uses it as its default `threshold`, so a plain click is a tap
 * everywhere rather than a zero-length drag in some places.
 */
export const DEFAULT_SLOP = 8;
