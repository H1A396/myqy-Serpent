import { useLayoutEffect, useState, type ReactNode } from "react";
import { workspaceTabOutlinePath } from "./workspace-tab-outline-path";

const FALLBACK_SCOOP = 18;
const FALLBACK_RADIUS = 14;

function readPx(raw: string, fallback: number): number {
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Vector outline for the active tab only. Sized to the parent `.workspace-tab`
 * border box; extends horizontally by one scoop on each side so scoop feet are
 * inside the viewBox. Stroke is a single open path — no CSS border, no radial
 * ring hacks.
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
      setBox({
        w: rect.width,
        h: rect.height,
        scoop,
        radius,
      });
    };

    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(tab);
    return () => ro.disconnect();
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
      style={{
        position: "absolute",
        left: -S,
        top: 0,
        width: box ? vbW : undefined,
        height: box ? h : undefined,
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      {box ? (
        <path
          d={path}
          fill="none"
          stroke="var(--island-tab-stroke, var(--island-border))"
          strokeWidth={1}
          strokeLinecap="butt"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      ) : null}
    </svg>
  );
}
