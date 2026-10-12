import { useCallback, useRef, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";

import {
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
/** Thumb travel is inset from the pad edge so the sphere never collides with it. */
const THUMB_INSET = 16;
const KEY_STEP_LARGE = 12;

/**
 * a87: 2D elevation trackpad. X = shadow size, Y = intensity (up = stronger).
 * Bottom-left corner (either axis ~0) = off. The pad itself floats and casts
 * the chosen shadow (island math); the sphere thumb casts its own shadow.
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
      const w = Math.max(1, r.width - THUMB_INSET * 2);
      const h = Math.max(1, r.height - THUMB_INSET * 2);
      const x = (clientX - r.left - THUMB_INSET) / w;
      const y = 1 - (clientY - r.top - THUMB_INSET) / h;
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

  const padStyle = {
    "--pad-elev-size": String(shadowPreferenceToMultiplier(size)),
    "--pad-elev-intensity": String(shadowPreferenceToMultiplier(intensity)),
    "--pad-fx": String(size / SHADOW_VALUE_MAX),
    "--pad-fy": String(1 - intensity / SHADOW_VALUE_MAX),
    "--pad-inset": `${THUMB_INSET}px`,
  } as CSSProperties;

  return (
    <div className="elevation-pad-field">
      <div className="elevation-pad-stage">
        <div
          className={`elevation-pad${enabled ? "" : " is-off"}`}
          onLostPointerCapture={() => { dragging.current = false; }}
          onPointerCancel={endDrag}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endDrag}
          ref={padRef}
          style={padStyle}
        >
          <span aria-hidden="true" className="elevation-pad-field-dots" />
          <span aria-hidden="true" className="elevation-pad-guide elevation-pad-guide-x" />
          <span aria-hidden="true" className="elevation-pad-guide elevation-pad-guide-y" />
          <span aria-hidden="true" className="elevation-pad-label elevation-pad-label-y">
            {labels.intensity}
          </span>
          <span aria-hidden="true" className="elevation-pad-label elevation-pad-label-x">
            {labels.size}
          </span>
          <span aria-hidden="true" className="elevation-pad-label elevation-pad-label-off">
            {labels.off}
          </span>
          <div
            aria-label={labels.pad}
            aria-valuemax={SHADOW_VALUE_MAX}
            aria-valuemin={SHADOW_VALUE_MIN}
            aria-valuenow={size}
            aria-valuetext={enabled ? labels.valueText(size, intensity) : labels.off}
            className="elevation-pad-thumb"
            onKeyDown={onKeyDown}
            role="slider"
            tabIndex={0}
          >
            <span aria-hidden="true" className="elevation-pad-thumb-shadow" />
            <span aria-hidden="true" className="elevation-pad-sphere" />
          </div>
        </div>
      </div>
      <div aria-hidden="true" className="elevation-pad-readout">
        {enabled ? (
          <>
            <span>{labels.size}</span>
            <b>{size}</b>
            <i />
            <span>{labels.intensity}</span>
            <b>{intensity}</b>
          </>
        ) : (
          <span>{labels.off}</span>
        )}
      </div>
    </div>
  );
}
