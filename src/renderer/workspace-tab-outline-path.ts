/**
 * Open SVG path for an active workspace-tab silhouette outline.
 *
 * Coordinate system: tab border-box, origin = top-left outer corner.
 * Scoop feet sit in [-scoop, 0] × [H−scoop, H] and [W, W+scoop] × [H−scoop, H]
 * matching `.workspace-tab.is-active::before/::after` (radial fill outside a
 * circle centered at the scoop-box outer-top corner).
 *
 * Path is OPEN along the baseline between scoop tips so the stroke does not
 * close across the toolstrip join.
 */
export function workspaceTabOutlinePath(
  width: number,
  height: number,
  scoop: number,
  radius: number,
): string {
  const W = Math.max(width, 1);
  const H = Math.max(height, scoop + 1);
  const S = Math.max(scoop, 1);
  const R = Math.min(Math.max(radius, 0), W / 2, Math.max(H - S, 0));

  // Left tip → left scoop arc → up left → top-left corner → top → top-right
  // → down right → right scoop arc → right tip. No Z.
  // Left scoop center (−S, H−S): start (−S, H) → end (0, H−S), CCW quarter.
  // Right scoop center (W+S, H−S): start (W, H−S) → end (W+S, H), CW quarter (sweep 0).
  return [
    `M ${-S} ${H}`,
    `A ${S} ${S} 0 0 1 0 ${H - S}`,
    `L 0 ${R}`,
    `A ${R} ${R} 0 0 1 ${R} 0`,
    `L ${W - R} 0`,
    `A ${R} ${R} 0 0 1 ${W} ${R}`,
    `L ${W} ${H - S}`,
    `A ${S} ${S} 0 0 0 ${W + S} ${H}`,
  ].join(" ");
}
