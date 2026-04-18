import type { Map } from 'maplibre-gl';

/**
 * Inverted touch gestures — matches the HypaMaps 3D viewer:
 *
 *   One finger  → rotate (change bearing)
 *   Two fingers → pan
 *   Pinch       → zoom (distance change between the two fingers)
 *
 * Default MapLibre touch behaviour is one-finger pan + two-finger
 * pinch-zoom/rotate. The CMS route planner iframe sits next to the 3D
 * model viewer, and users kept confusing the two — swapping the touch
 * axes here keeps the mental model consistent.
 *
 * Mouse behaviour is untouched: left-drag still pans, right-drag
 * still rotates, scroll still zooms. We take over ONLY touch.
 *
 * Implementation notes
 * - We disable MapLibre's default touch-related handlers (dragPan,
 *   touchZoomRotate, touchPitch) BEFORE attaching our own listeners.
 *   Disabling dragPan also kills mouse-drag-pan, so we reimplement
 *   that with a lightweight mousedown/mousemove/mouseup pair below.
 * - We listen on the map's canvas container with `passive: false` so
 *   we can preventDefault on touch, stopping page scroll hijack.
 * - We do NOT stop propagation. MapLibre's internal event system
 *   still fires `touchstart` / `touchend` / etc. on the map instance
 *   so react-map-gl's `onTouchStart` / `onTouchEnd` props keep
 *   working (waypoint long-press etc. relies on them).
 */

type TouchState =
  | null
  | {
      mode: 'rotate';
      startX: number;
      startBearing: number;
    }
  | {
      mode: 'pan-zoom';
      startDistance: number;
      startCentroidX: number;
      startCentroidY: number;
      startZoom: number;
      startCenterLng: number;
      startCenterLat: number;
    };

type MouseState = null | {
  lastX: number;
  lastY: number;
};

// Degrees of bearing change per pixel of horizontal finger drag.
const ROTATE_SENSITIVITY = 0.35;

export function installInvertedTouchGestures(map: Map): () => void {
  // Turn off the defaults we're replacing.
  map.dragPan.disable();
  map.touchZoomRotate.disable();
  map.touchPitch.disable();

  const container = map.getCanvasContainer();

  // ── Touch: 1 finger rotate, 2 finger pan + pinch zoom ──────────────────
  let touch: TouchState = null;

  const beginTouch = (e: TouchEvent) => {
    const t1 = e.touches[0];
    const t2 = e.touches[1];
    if (e.touches.length === 1 && t1) {
      touch = {
        mode: 'rotate',
        startX: t1.clientX,
        startBearing: map.getBearing(),
      };
    } else if (e.touches.length >= 2 && t1 && t2) {
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      const center = map.getCenter();
      touch = {
        mode: 'pan-zoom',
        startDistance: Math.hypot(dx, dy) || 1,
        startCentroidX: (t1.clientX + t2.clientX) / 2,
        startCentroidY: (t1.clientY + t2.clientY) / 2,
        startZoom: map.getZoom(),
        startCenterLng: center.lng,
        startCenterLat: center.lat,
      };
    } else {
      touch = null;
    }
  };

  const onTouchStart = (e: TouchEvent) => {
    if (!e.touches.length) return;
    e.preventDefault();
    beginTouch(e);
  };

  const onTouchMove = (e: TouchEvent) => {
    if (!touch) return;
    e.preventDefault();

    const t1 = e.touches[0];
    const t2 = e.touches[1];

    if (touch.mode === 'rotate' && e.touches.length === 1 && t1) {
      const deltaX = t1.clientX - touch.startX;
      map.setBearing(touch.startBearing + deltaX * ROTATE_SENSITIVITY);
      return;
    }

    if (touch.mode === 'pan-zoom' && e.touches.length >= 2 && t1 && t2) {
      const dx = t2.clientX - t1.clientX;
      const dy = t2.clientY - t1.clientY;
      const currentDistance = Math.hypot(dx, dy) || 1;
      const currentCentroidX = (t1.clientX + t2.clientX) / 2;
      const currentCentroidY = (t1.clientY + t2.clientY) / 2;

      // Zoom: log2 ratio of pinch distance gives a consistent feel.
      const zoomDelta = Math.log2(currentDistance / touch.startDistance);
      const nextZoom = touch.startZoom + zoomDelta;

      // Pan: convert the centroid pixel delta into a map-centre shift.
      const startCenterPoint = map.project([
        touch.startCenterLng,
        touch.startCenterLat,
      ]);
      const panDx = currentCentroidX - touch.startCentroidX;
      const panDy = currentCentroidY - touch.startCentroidY;
      const nextCenter = map.unproject([
        startCenterPoint.x - panDx,
        startCenterPoint.y - panDy,
      ]);

      // Apply zoom first so project/unproject maths stay aligned.
      map.jumpTo({ zoom: nextZoom, center: nextCenter });
    }
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length === 0) {
      touch = null;
      return;
    }
    // Finger count changed mid-gesture — re-seed the baseline so the
    // next move isn't interpreted relative to a stale anchor.
    beginTouch(e);
  };

  // ── Mouse: restore left-drag pan (dragPan was disabled above) ──────────
  let mouse: MouseState = null;

  const onMouseDown = (e: MouseEvent) => {
    // Left button only; right-click still rotates via maplibre's
    // separate `dragRotate` handler which we left enabled.
    if (e.button !== 0) return;
    mouse = { lastX: e.clientX, lastY: e.clientY };
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!mouse) return;
    const dx = e.clientX - mouse.lastX;
    const dy = e.clientY - mouse.lastY;
    mouse.lastX = e.clientX;
    mouse.lastY = e.clientY;
    map.panBy([-dx, -dy], { duration: 0 });
  };

  const onMouseUp = () => {
    mouse = null;
  };

  // ── Wire listeners ─────────────────────────────────────────────────────
  container.addEventListener('touchstart', onTouchStart, { passive: false });
  container.addEventListener('touchmove', onTouchMove, { passive: false });
  container.addEventListener('touchend', onTouchEnd, { passive: false });
  container.addEventListener('touchcancel', onTouchEnd, { passive: false });

  container.addEventListener('mousedown', onMouseDown);
  // mousemove / mouseup on window so we don't lose a drag if the cursor
  // leaves the map canvas before release.
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  // Cleanup — caller runs this on unmount / style change.
  return () => {
    container.removeEventListener('touchstart', onTouchStart);
    container.removeEventListener('touchmove', onTouchMove);
    container.removeEventListener('touchend', onTouchEnd);
    container.removeEventListener('touchcancel', onTouchEnd);
    container.removeEventListener('mousedown', onMouseDown);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);

    // Restore defaults in case the map outlives this handler set.
    map.dragPan.enable();
    map.touchZoomRotate.enable();
    map.touchPitch.enable();
  };
}
