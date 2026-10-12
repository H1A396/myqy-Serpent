/**
 * Open SVG path for the active workspace-tab chrome silhouette (fill + stroke).
 *
 * Coordinate system: tab border-box, origin = top-left outer corner.
 * Scoop feet match CSS `--workspace-tab-scoop` / `--workspace-tab-curve`.
 *
 * `strokeInset` (typically half the 1px stroke) pulls the path inward so a
 * centered SVG stroke’s OUTER edge lands on that CSS silhouette.
 *
 * Path is OPEN along the baseline between scoop tips so fill auto-closes
 * (tab+scoops) and stroke does not draw a divider under the tab. The island
 * top hairline outside the scoops is a single full-width CSS stroke (not
 * pieced gradients) so thickness stays uniform.
 */
export function workspaceTabOutlinePath(
  width: number,
  height: number,
  scoop: number,
  radius: number,
  strokeInset = 0,
): string {
  const W = Math.max(width, 1);
  const H = Math.max(height, scoop + 1);
  const S = Math.max(scoop, 1);
  const R = Math.min(Math.max(radius, 0), W / 2, Math.max(H - S, 0));
  const i = Math.max(0, Math.min(strokeInset, S - 0.5, R > 0 ? R - 0.5 : 0));

  const x0 = i;
  const x1 = W - i;
  const yTop = i;
  const s = S - i;
  const r = Math.max(R - i, 0);
  const yJoin = H - s;

  return [
    `M ${-S + i} ${H}`,
    `A ${s} ${s} 0 0 0 ${x0} ${yJoin}`,
    `L ${x0} ${r > 0 ? r : yTop}`,
    r > 0 ? `A ${r} ${r} 0 0 1 ${r} ${yTop}` : "",
    `L ${W - (r > 0 ? r : i)} ${yTop}`,
    r > 0 ? `A ${r} ${r} 0 0 1 ${x1} ${r}` : "",
    `L ${x1} ${yJoin}`,
    `A ${s} ${s} 0 0 0 ${W + S - i} ${H}`,
  ]
    .filter(Boolean)
    .join(" ");
}
