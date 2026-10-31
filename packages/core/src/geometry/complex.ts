/**
 * The complex-number value type. Here, below `scene/` and `anim/`, so both
 * `<ComplexPlane>` and `applyComplexFunction` can name it without `anim/`
 * importing `scene/`.
 */

/**
 * A complex number, as data.
 *
 * `{ re, im }` rather than `{ x, y }` on purpose: a `Point` in this codebase is
 * always *scene units*, and a plane whose whole job is converting between the
 * two cannot afford a type that reads as either. The compiler now catches the
 * confusion that would otherwise show up as a silently misplaced dot.
 *
 * @category Coordinate systems & graphs
 */
export interface Complex {
	/** Real part, in data units. */
	re: number;
	/** Imaginary part, in data units. */
	im: number;
}
