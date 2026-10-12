import { useCallback, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

import {
  SHADOW_OFF_THRESHOLD,
  SHADOW_VALUE_MAX,
  SHADOW_VALUE_MIN,
  clampShadowValue,
  isShadowPreferenceEnabled,
  shadowPreferenceToMultiplier,
  type ShadowPreferences,
} from "./shadow-preferences";

export type ElevationPadLabels = {
  readonly pad: string;
  readonly size: string;
  readonly intensity: string;
  readonly off: string;
  readonly valueText: (size: number, intensity: number) => string;
};

export type ElevationPadProps = {
  readonly preferences: ShadowPreferences;
  readonly onChange: (size: number, intensity: number) => void;
  readonly labels: ElevationPadLabels;
};

const KEY_STEP = 4;
const KEY_STEP_LARGE = 12;

/**
 * a87: 2D elevation trackpad. X = shadow size, Y = intensity (up = stronger).
 * Bottom-left corner (either axis ~0) = off. The pad renders a live preview
 * card using the picked values; the app's --elev-* vars update as you drag.
 */
export function ElevationPad({ preferences, onChange, labels }: ElevationPadProps) {
  const padRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const { size, intensity } = preferences;
  const enabled = isShadowPreferenceEnabled(preferences);

  const pick = useCallback(
    (clientX: number, clientY: number) => {
      const el = padRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return;
      const x = (clientX - r.left) / r.width;
      const y = 1 - (clientY - r.top) / r.height;
      onChange(clampShadowValue(x * SHADOW_VALUE_MAX), clampShadowValue(y * SHADOW_VALUE_MAX));
    },
    [onChange],
  );

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    pick(event.clientX, event.clientY);
    event.currentTarget.querySelector<HTMLElement>(".elevation-pad-thumb")?.focus({ preventScroll: true });
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (dragging.current) pick(event.clientX, event.clientY);
  };
  const endDrag = (event: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    let nextSize = size;
    let nextIntensity = intensity;
    switch (event.key) {
      case "ArrowLeft": nextSize -= step; break;
      case "ArrowRight": nextSize += step; break;
      case "ArrowUp": nextIntensity += step; break;
      case "ArrowDown": nextIntensity -= step; break;
      case "Home": nextSize = SHADOW_VALUE_MIN; nextIntensity = SHADOW_VALUE_MIN; break;
      case "End": nextSize = SHADOW_VALUE_MAX; nextIntensity = SHADOW_VALUE_MAX; break;
      default: return;
    }
    event.preventDefault();
    onChange(clampShadowValue(nextSize), clampShadowValue(nextIntensity));
  };

  const previewStyle = {
    "--pad-elev-size": String(shadowPreferenceToMultiplier(size)),
    "--pad-elev-intensity": String(shadowPreferenceToMultiplier(intensity)),
  } as CSSProperties;
  const offZone = `${(SHADOW_OFF_THRESHOLD / SHADOW_VALUE_MAX) * 100}%`;

  return (
    <div className="elevation-pad-field">
      <div className="elevation-pad-body">
        <span aria-hidden="true" className="elevation-pad-axis elevation-pad-axis-y">
          <span>↑</span>
          {Array.from(labels.intensity).map((ch, i) => (
            <span key={i}>{ch}</span>
          ))}
        </span>
        <div
          className={`elevation-pad${enabled ? "" : " is-off"}`}
          onLostPointerCapture={() => { dragging.current = false; }}
          onPointerCancel={endDrag}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          ref={padRef}
          style={{ ["--pad-off-zone" as string]: offZone } as CSSProperties}
        >
          <div aria-hidden="true" className="elevation-pad-grid" />
          <div aria-hidden="true" className="elevation-pad-preview" style={previewStyle}>
            <span />
            <span />
          </div>
          <div
            aria-label={labels.pad}
            aria-valuemax={SHADOW_VALUE_MAX}
            aria-valuemin={SHADOW_VALUE_MIN}
            aria-valuenow={size}
            aria-valuetext={enabled ? labels.valueText(size, intensity) : labels.off}
            className="elevation-pad-thumb"
            onKeyDown={onKeyDown}
            role="slider"
            style={{ left: `${size}%`, top: `${100 - intensity}%` }}
            tabIndex={0}
          />
        </div>
      </div>
      <div aria-hidden="true" className="elevation-pad-foot">
        <span className="elevation-pad-off-label">{labels.off}</span>
        <span className="elevation-pad-axis elevation-pad-axis-x">{labels.size} →</span>
        <span className="elevation-pad-readout">
          {enabled ? labels.valueText(size, intensity) : labels.off}
        </span>
      </div>
    </div>
  );
}
