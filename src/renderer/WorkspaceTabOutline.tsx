import { useLayoutEffect, useState, type ReactNode } from "react";
import { workspaceTabOutlinePath } from "./workspace-tab-outline-path";

const FALLBACK_SCOOP = 18;
const FALLBACK_RADIUS = 14;

function readPx(raw: string, fallback: number): number {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/** Snap CSS px length to a device-pixel multiple so 1px strokes stay 1 device px. */
function snapCssPx(cssPx: number): number {
  const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
  return Math.round(cssPx * dpr) / dpr;
}

/**
 * Single-geometry chrome for the active tab: one SVG path paints fill + stroke.
 *
 * Scoop tips sit on the center island's top pixel centerline so the 1px SVG
 * stroke lands on the same device row as the panel-top seam gradients (identical
 * --island-border ink). Publishes --tab-seam-hole-* to interrupt that seam
 * under the chrome — no divider across the tab face.
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
      const rect = tab.getBoundingClientRect();

      const workspace = tab
        .closest(".app-shell")
        ?.querySelector(":scope > .workspace") as HTMLElement | null;

      // 1px stroke is centered on the path. Baseline = panel-top pixel center
      // (snapped top edge + 0.5) so it shares the seam gradient's device row.
      let faceH: number;
      if (workspace) {
        const wr = workspace.getBoundingClientRect();
        const topEdge = snapCssPx(wr.top - rect.top);
        faceH = Math.max(topEdge + 0.5, scoop + 1);
      } else {
        const padBottom = readPx(cs.paddingBottom, 0);
        faceH = Math.max(snapCssPx(rect.height - padBottom), scoop + 1);
      }

      setBox({
        w: snapCssPx(rect.width),
        h: faceH,
        scoop: snapCssPx(scoop),
        radius: snapCssPx(radius),
      });

      if (workspace) {
        const wr = workspace.getBoundingClientRect();
        // Hole spans tip-to-tip; 0.5px inset buries butt AA under seam ink.
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
