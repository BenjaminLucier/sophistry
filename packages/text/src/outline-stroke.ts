/**
 * Width of the outline a formula is written with, per em of `fontSize`.
 *
 * Manim's `Write` traces each glyph with `stroke_width=2`, which its Cairo
 * camera draws at 0.02 frame units, on type whose em is about two thirds of a
 * unit at the default 48pt: roughly 0.03 em. The outline is only there while
 * a glyph is being written; a finished formula is fill alone, as a Manim
 * `MathTex` (`stroke_width=0`) is.
 *
 * Exported so a formula written part by part from `createLatex` can match
 * `MathTex`: see `writePhase`.
 */
export const OUTLINE_RATIO = 0.03;
