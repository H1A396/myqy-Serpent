import { useLayoutEffect, useState, type ReactNode } from "react";
import { workspaceTabOutlinePath } from "./workspace-tab-outline-path";

const FALLBACK_SCOOP = 18;
const FALLBACK_RADIUS = 14;

function readPx(raw: string, fallback: number): number {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Single-geometry chrome for the active tab: one SVG path paints both fill and
 * stroke (open bottom into the toolstrip). No CSS scoop fills / border rings.
 *
 * Also publishes --tab-seam-hole-left/right on the workspace island so its top
 * border is interrupted under the chrome (Chrome-style continuous edge: SVG
 * scoops own the join; island hairline continues outside the tips only).
 */
export function WorkspaceTabOutline(): ReactNode {
  const [host, setHost] = useState<SVGSVGElement | null>(null);
  const [box, setBox] = useState<{
    w: number;
    h: number;
    scoop: number;
    radius: number;
  } | null>(null);

  useLayoutEffect(() => {
    const tab = host?.parentElement;
    if (!tab) return;

    const measure = () => {
      const cs = getComputedStyle(tab);
      const tabs = tab.closest(".workspace-tabs");
      const tcs = tabs ? getComputedStyle(tabs) : null;
      const scoop = readPx(
        tcs?.getPropertyValue("--workspace-tab-scoop") ?? "",
        FALLBACK_SCOOP,
      );
      const radius = readPx(cs.borderTopLeftRadius, FALLBACK_RADIUS);
      const padBottom = readPx(cs.paddingBottom, 0);
      const rect = tab.getBoundingClientRect();
      const faceH = Math.max(rect.height - padBottom, scoop + 1);
      setBox({
        w: rect.width,
        h: faceH,
        scoop,
        radius,
      });

      // Tabs live in the toolbar; the island they join is a sibling .workspace.
      const workspace = tab
        .closest(".app-shell")
        ?.querySelector(":scope > .workspace") as HTMLElement | null;
      if (workspace) {
        const wr = workspace.getBoundingClientRect();
        // Pull the seam hole 0.5px inward so each tip sits under the hairline
        // segment — buries butt-cap AA without a second geometry.
        const tipInset = 0.5;
        const leftTip = rect.left - scoop - wr.left + tipInset;
        const rightTip = rect.right + scoop - wr.left - tipInset;
        workspace.style.setProperty(
          "--tab-seam-hole-left",
          `${Math.max(0, leftTip)}px`,
        );
        workspace.style.setProperty(
          "--tab-seam-hole-right",
          `${Math.max(0, rightTip)}px`,
        );
      }
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(tab);
    const workspace = tab
      .closest(".app-shell")
      ?.querySelector(":scope > .workspace") as HTMLElement | null;
    if (workspace) ro.observe(workspace);
    return () => {
      ro.disconnect();
      workspace?.style.removeProperty("--tab-seam-hole-left");
      workspace?.style.removeProperty("--tab-seam-hole-right");
    };
  }, [host]);

  const S = box?.scoop ?? FALLBACK_SCOOP;
  const h = box?.h ?? 0;
  const w = box?.w ?? 0;
  const path =
    box === null ? "" : workspaceTabOutlinePath(w, h, S, box.radius);
  const vbW = w + 2 * S;

  return (
    <svg
      ref={setHost}
      className="workspace-tab-outline"
      aria-hidden="true"
      focusable="false"
      width={box ? vbW : undefined}
      height={box ? h : undefined}
      viewBox={box ? `${-S} 0 ${vbW} ${h}` : undefined}
    >
      {box ? <path className="workspace-tab-outline-path" d={path} /> : null}
    </svg>
  );
}
