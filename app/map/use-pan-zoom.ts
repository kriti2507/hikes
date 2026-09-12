"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HEIGHT, WIDTH } from "@/lib/map/projection.mjs";

export const MIN_SCALE = 1;

// Roughly one prefecture filling the view. The stored coordinates are good to
// about a kilometre, which is ~4px here against a 14px triangle: the error
// stays visibly inside the symbol. Zooming further would imply a precision the
// data does not have. See the design spec.
export const MAX_SCALE = 16;

// Above this the map has room to name peaks as well as number them.
export const NAME_SCALE = 6;

type Camera = { scale: number; cx: number; cy: number };

const clamp = (value: number, low: number, high: number) =>
  Math.min(high, Math.max(low, value));

function clampCamera({ scale, cx, cy }: Camera): Camera {
  const next = clamp(scale, MIN_SCALE, MAX_SCALE);
  const w = WIDTH / next;
  const h = HEIGHT / next;
  // Keep the country in view: the centre cannot wander past half a viewport
  // from either edge, so there is no way to pan into empty space.
  return {
    scale: next,
    cx: clamp(cx, w / 2, WIDTH - w / 2),
    cy: clamp(cy, h / 2, HEIGHT - h / 2),
  };
}

const FIT: Camera = { scale: MIN_SCALE, cx: WIDTH / 2, cy: HEIGHT / 2 };

export function usePanZoom(element: SVGSVGElement | null) {
  const [camera, setCamera] = useState<Camera>(FIT);
  const [width, setWidth] = useState(0);

  // Pointers currently down, by pointerId, in client coordinates. A ref rather
  // than state: these change on every move and must not drive a render.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ gap: number; scale: number } | null>(null);

  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  const viewWidth = WIDTH / camera.scale;
  const viewHeight = HEIGHT / camera.scale;
  const minX = camera.cx - viewWidth / 2;
  const minY = camera.cy - viewHeight / 2;

  // How many map units one CSS pixel covers. Clustering and marker sizing both
  // key off this, which is what makes them zoom-independent.
  const unitsPerPixel = width > 0 ? viewWidth / width : WIDTH / 600;

  const viewBox = `${minX} ${minY} ${viewWidth} ${viewHeight}`;

  /** Client coordinates to map units. */
  const toMap = useCallback(
    (clientX: number, clientY: number) => {
      if (!element) return { x: camera.cx, y: camera.cy };
      const box = element.getBoundingClientRect();
      return {
        x: minX + ((clientX - box.left) / box.width) * viewWidth,
        y: minY + ((clientY - box.top) / box.height) * viewHeight,
      };
    },
    [element, camera.cx, camera.cy, minX, minY, viewWidth, viewHeight],
  );

  /** Zoom by a factor while holding one map point under the same pixel. */
  const zoomAround = useCallback((factor: number, anchor: { x: number; y: number }) => {
    setCamera((current) => {
      const scale = clamp(current.scale * factor, MIN_SCALE, MAX_SCALE);
      const actual = scale / current.scale;
      return clampCamera({
        scale,
        cx: anchor.x + (current.cx - anchor.x) / actual,
        cy: anchor.y + (current.cy - anchor.y) / actual,
      });
    });
  }, []);

  /** Zoom by a factor about the centre — for the on-screen buttons. */
  const zoomBy = useCallback((factor: number) => {
    setCamera((current) => clampCamera({ ...current, scale: current.scale * factor }));
  }, []);

  const fit = useCallback(() => setCamera(FIT), []);

  /** Frame a rectangle of map units with a margin — for zoom-to-cluster. */
  const fitBounds = useCallback((x0: number, y0: number, x1: number, y1: number) => {
    const padding = 1.6;
    const scale = Math.min(
      WIDTH / Math.max(x1 - x0, 1e-6) / padding,
      HEIGHT / Math.max(y1 - y0, 1e-6) / padding,
    );
    setCamera(clampCamera({ scale, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 }));
  }, []);

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pinchStart.current = null;
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, next);

    const touches = [...pointers.current.values()];

    if (touches.length >= 2) {
      const [a, b] = touches;
      const gap = Math.hypot(a.x - b.x, a.y - b.y);
      if (!pinchStart.current) {
        pinchStart.current = { gap, scale: camera.scale };
        return;
      }
      const target = clamp(
        (pinchStart.current.scale * gap) / pinchStart.current.gap,
        MIN_SCALE,
        MAX_SCALE,
      );
      const midpoint = toMap((a.x + b.x) / 2, (a.y + b.y) / 2);
      zoomAround(target / camera.scale, midpoint);
      return;
    }

    // Single pointer: drag the paper. Moving the pointer right moves the map
    // right, so the camera goes left.
    const box = event.currentTarget.getBoundingClientRect();
    const dx = ((next.x - previous.x) / box.width) * viewWidth;
    const dy = ((next.y - previous.y) / box.height) * viewHeight;
    setCamera((current) => clampCamera({ ...current, cx: current.cx - dx, cy: current.cy - dy }));
  }

  function onPointerUp(event: React.PointerEvent<SVGSVGElement>) {
    pointers.current.delete(event.pointerId);
    if (pointers.current.size < 2) pinchStart.current = null;
  }

  // Wheel is bound natively rather than through React's onWheel: React attaches
  // wheel listeners passively, and a passive listener cannot preventDefault, so
  // the page would scroll behind the map as you zoomed.
  useEffect(() => {
    if (!element) return;
    const handler = (event: WheelEvent) => {
      event.preventDefault();
      zoomAround(Math.exp(-event.deltaY / 400), toMap(event.clientX, event.clientY));
    };
    element.addEventListener("wheel", handler, { passive: false });
    return () => element.removeEventListener("wheel", handler);
  }, [element, zoomAround, toMap]);

  return {
    scale: camera.scale,
    viewBox,
    unitsPerPixel,
    zoomBy,
    fit,
    fitBounds,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  };
}
