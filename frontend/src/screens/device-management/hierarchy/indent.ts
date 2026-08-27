/**
 * The tree's indentation maths, shared so the level bar above the tree lines
 * up with the depth each level actually sits at.
 */

export const INDENT_PX = 20;
export const GUTTER_PX = 12;

export const indentFor = (depth: number) => depth * INDENT_PX + GUTTER_PX;
