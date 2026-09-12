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

// A few pixels of travel is a shaky tap, not a drag. Above this the gesture
// was a pan and any click it synthesises should be ignored.
const DRAG_SLOP = 5;

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

// Only fitBounds (zoom-to-ridge) eases -- wheel, drag, pinch and the on-screen
// buttons are direct manipulation, and easing those would just make them feel
// laggy. 320ms is enough to read as a deliberate camera move rather than a
// jump, without making the ridge feel slow to open.
const FIT_DURATION_MS = 320;
const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;

export function usePanZoom(element: SVGSVGElement | null) {
  const [camera, setCamera] = useState<Camera>(FIT);
  const [width, setWidth] = useState(0);
  const [measured, setMeasured] = useState(false);

  // The tween reads its start point from here rather than from `camera`
  // directly: fitBounds is a useCallback with a stable identity (so its
  // prop reference does not change on every render), and closing over
  // `camera` would either go stale or force it to be recreated each render.
  const cameraRef = useRef(camera);
  cameraRef.current = camera;

  // The one rAF handle a fit animation can occupy. Any interrupting input --
  // pointerdown, wheel, a zoom button, or a second fitBounds -- cancels it
  // before doing anything else, so at most one tween is ever in flight.
  const animationFrame = useRef<number | null>(null);
  const cancelAnimation = useCallback(() => {
    if (animationFrame.current === null) return;
    cancelAnimationFrame(animationFrame.current);
    animationFrame.current = null;
  }, []);
  // Belt and braces against a tween outliving the component: without this, a
  // fitBounds triggered just before the map view unmounts would keep calling
  // setCamera on a component no longer there.
  useEffect(() => cancelAnimation, [cancelAnimation]);

  // Pointers currently down, by pointerId, in client coordinates. A ref rather
  // than state: these change on every move and must not drive a render.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchStart = useRef<{ gap: number; scale: number } | null>(null);

  // A drag that ends over a peak must not open it. The browser synthesises a
  // click on whatever was pressed regardless of pointer capture, so markers
  // ask this before acting.
  const travelled = useRef(0);
  const dragged = useRef(false);

  useEffect(() => {
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setWidth(entry.contentRect.width);
      setMeasured(true);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [element]);

  const viewWidth = WIDTH / camera.scale;
  const viewHeight = HEIGHT / camera.scale;
  const minX = camera.cx - viewWidth / 2;
  const minY = camera.cy - viewHeight / 2;

  // How many map units one CSS pixel covers. Clustering and marker sizing both
  // key off this, which is what makes them zoom-independent. Before the first
  // ResizeObserver callback this is a placeholder guess, not a measurement —
  // no consumer should render markers against it. Check `measured` instead.
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

  /** Zoom to an absolute scale while holding one map point under the same
      pixel. Pinch computes an absolute target from a fixed reference, so
      converting it to a relative factor outside the updater would read a
      possibly-stale scale — this keeps the whole calculation inside it. */
  const zoomTo = useCallback((scale: number, anchor: { x: number; y: number }) => {
    setCamera((current) => {
      const next = clamp(scale, MIN_SCALE, MAX_SCALE);
      const actual = next / current.scale;
      return clampCamera({
        scale: next,
        cx: anchor.x + (current.cx - anchor.x) / actual,
        cy: anchor.y + (current.cy - anchor.y) / actual,
      });
    });
  }, []);

  /** Zoom by a factor about the centre — for the on-screen buttons. */
  const zoomBy = useCallback(
    (factor: number) => {
      cancelAnimation(); // a button press is direct manipulation; it wins over any tween in flight
      setCamera((current) => clampCamera({ ...current, scale: current.scale * factor }));
    },
    [cancelAnimation],
  );

  const fit = useCallback(() => {
    cancelAnimation();
    setCamera(FIT);
  }, [cancelAnimation]);

  /** Frame a rectangle of map units with a margin — for zoom-to-cluster. Eases
      unless the OS asks for reduced motion, checked here rather than once at
      mount so a setting changed mid-session is honoured without a reload. */
  const fitBounds = useCallback(
    (x0: number, y0: number, x1: number, y1: number) => {
      const padding = 1.6;
      const scale = Math.min(
        WIDTH / Math.max(x1 - x0, 1e-6) / padding,
        HEIGHT / Math.max(y1 - y0, 1e-6) / padding,
      );
      const target = clampCamera({ scale, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 });

      cancelAnimation();

      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setCamera(target);
        return;
      }

      const start = cameraRef.current;
      const startTime = performance.now();

      const step = (now: number) => {
        const t = Math.min((now - startTime) / FIT_DURATION_MS, 1);
        const eased = easeOutCubic(t);
        setCamera(
          clampCamera({
            scale: start.scale + (target.scale - start.scale) * eased,
            cx: start.cx + (target.cx - start.cx) * eased,
            cy: start.cy + (target.cy - start.cy) * eased,
          }),
        );
        animationFrame.current = t < 1 ? requestAnimationFrame(step) : null;
      };
      animationFrame.current = requestAnimationFrame(step);
    },
    [cancelAnimation],
  );

  function onPointerDown(event: React.PointerEvent<SVGSVGElement>) {
    cancelAnimation(); // a drag or pinch beginning is direct manipulation; it wins over any tween in flight
    event.currentTarget.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    pinchStart.current = null;
    travelled.current = 0;
    dragged.current = false;
  }

  function onPointerMove(event: React.PointerEvent<SVGSVGElement>) {
    const previous = pointers.current.get(event.pointerId);
    if (!previous) return;
    const next = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, next);

    // Any pointer movement counts toward the drag threshold, whether it turned
    // out to be a one-finger pan or a two-finger pinch: either way the gesture
    // was not a tap, and the click it synthesises should be ignored.
    travelled.current += Math.hypot(next.x - previous.x, next.y - previous.y);

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
      zoomTo(target, midpoint);
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
    // pointerup fires before the browser's synthesised click, so by the time
    // a marker's click handler runs, this is already settled.
    if (travelled.current > DRAG_SLOP) dragged.current = true;
  }

  // Wheel is bound natively rather than through React's onWheel: React attaches
  // wheel listeners passively, and a passive listener cannot preventDefault, so
  // the page would scroll behind the map as you zoomed.
  useEffect(() => {
    if (!element) return;
    const handler = (event: WheelEvent) => {
      event.preventDefault();
      cancelAnimation(); // a wheel scroll is direct manipulation; it wins over any tween in flight
      zoomAround(Math.exp(-event.deltaY / 400), toMap(event.clientX, event.clientY));
    };
    element.addEventListener("wheel", handler, { passive: false });
    return () => element.removeEventListener("wheel", handler);
  }, [element, zoomAround, toMap, cancelAnimation]);

  return {
    scale: camera.scale,
    viewBox,
    unitsPerPixel,
    measured,
    wasDragged: () => dragged.current,
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
