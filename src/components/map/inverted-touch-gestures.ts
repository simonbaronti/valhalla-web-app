import type { Map } from 'maplibre-gl';

/**
 * Inverted gestures — matches the HypaMaps 3D viewer across input types.
 *
 * Touch:
 *   1 finger   → rotate
 *   2 fingers  → pan + pinch-zoom
 *
 * Mouse / trackpad:
 *   Left-drag           → rotate
 *   Right-drag          → pan
 *   2-finger trackpad   → pan (plain wheel deltas)
 *   Pinch / ctrl+wheel  → zoom
 *
 * We disable MapLibre's default touch, drag-pan, drag-rotate, and
 * scroll-zoom handlers and reimplement the subset we want. The Map
 * component must also pass `dragPan={false}` / `touchZoomRotate={false}`
 * / `touchPitch={false}` / `scrollZoom={false}` / `dragRotate={false}`
 * so react-map-gl does not re-enable them on re-render.
 */

type TouchState =
  | null
  | { mode: 'rotate'; startX: number; startBearing: number }
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
  mode: 'rotate' | 'pan';
  lastX: number;
  lastY: number;
  startX: number;
  startY: number;
  startBearing: number;
};

const ROTATE_SENSITIVITY = 0.35; // deg per px
const WHEEL_ZOOM_SENSITIVITY = 0.01; // zoom units per wheel-delta unit
const CLICK_DRAG_THRESHOLD_PX = 4;

// Set briefly when a mouse-up follows a drag; consumed by the map click
// handler so we don't open a popup at the end of a rotate/pan gesture.
let _suppressNextClick = false;
export function consumeSuppressedClick(): boolean {
  if (_suppressNextClick) {
    _suppressNextClick = false;
    return true;
  }
  return false;
}

export function installInvertedTouchGestures(map: Map): () => void {
  map.dragPan.disable();
  map.dragRotate.disable();
  map.touchZoomRotate.disable();
  map.touchPitch.disable();
  map.scrollZoom.disable();

  const container = map.getCanvasContainer();

  // ── Touch ──────────────────────────────────────────────────────────────
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

      // Zoom: pinch distance + vertical centroid drift both feed zoom,
      // so two-finger up/down and pinch-in/out both zoom.
      const pinchZoomDelta = Math.log2(currentDistance / touch.startDistance);
      const verticalZoomDelta =
        -(currentCentroidY - touch.startCentroidY) * 0.01;
      const nextZoom = touch.startZoom + pinchZoomDelta + verticalZoomDelta;

      // Pan: horizontal centroid drift only — vertical drift is for zoom.
      const startCenterPoint = map.project([
        touch.startCenterLng,
        touch.startCenterLat,
      ]);
      const panDx = currentCentroidX - touch.startCentroidX;
      const nextCenter = map.unproject([
        startCenterPoint.x - panDx,
        startCenterPoint.y,
      ]);

      map.jumpTo({ zoom: nextZoom, center: nextCenter });
    }
  };

  const onTouchEnd = (e: TouchEvent) => {
    if (e.touches.length === 0) {
      touch = null;
      return;
    }
    beginTouch(e);
  };

  // ── Mouse ──────────────────────────────────────────────────────────────
  // Left-drag rotates, right-drag pans.
  let mouse: MouseState = null;

  const onMouseDown = (e: MouseEvent) => {
    const mode: 'rotate' | 'pan' | null =
      e.button === 0 ? 'rotate' : e.button === 2 ? 'pan' : null;
    if (!mode) return;
    mouse = {
      mode,
      lastX: e.clientX,
      lastY: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      startBearing: map.getBearing(),
    };
  };

  const onMouseMove = (e: MouseEvent) => {
    if (!mouse) return;
    const dx = e.clientX - mouse.lastX;
    const dy = e.clientY - mouse.lastY;
    mouse.lastX = e.clientX;
    mouse.lastY = e.clientY;

    if (mouse.mode === 'rotate') {
      map.setBearing(map.getBearing() + dx * ROTATE_SENSITIVITY);
    } else {
      map.panBy([-dx, -dy], { duration: 0 });
    }
  };

  const onMouseUp = (e: MouseEvent) => {
    if (mouse) {
      const totalDx = e.clientX - mouse.startX;
      const totalDy = e.clientY - mouse.startY;
      if (Math.hypot(totalDx, totalDy) > CLICK_DRAG_THRESHOLD_PX) {
        _suppressNextClick = true;
      }
    }
    mouse = null;
  };

  // Prevent the browser's context menu so right-drag-pan feels clean.
  const onContextMenu = (e: MouseEvent) => e.preventDefault();

  // ── Wheel ──────────────────────────────────────────────────────────────
  // All wheel input → zoom toward cursor.
  // Mouse scroll wheel, trackpad two-finger swipe, and pinch (ctrl+wheel)
  // all zoom. Pinch sends bigger deltas so we scale it down.
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const rawDelta = e.deltaY;
    const zoomDelta = -rawDelta * WHEEL_ZOOM_SENSITIVITY;
    const rect = container.getBoundingClientRect();
    const around = map.unproject([e.clientX - rect.left, e.clientY - rect.top]);
    const nextZoom = Math.max(
      map.getMinZoom(),
      Math.min(map.getMaxZoom(), map.getZoom() + zoomDelta)
    );
    map.jumpTo({ zoom: nextZoom, center: around });
  };

  // ── Wire listeners ─────────────────────────────────────────────────────
  container.addEventListener('touchstart', onTouchStart, { passive: false });
  container.addEventListener('touchmove', onTouchMove, { passive: false });
  container.addEventListener('touchend', onTouchEnd, { passive: false });
  container.addEventListener('touchcancel', onTouchEnd, { passive: false });

  container.addEventListener('mousedown', onMouseDown);
  container.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  container.addEventListener('wheel', onWheel, { passive: false });

  return () => {
    container.removeEventListener('touchstart', onTouchStart);
    container.removeEventListener('touchmove', onTouchMove);
    container.removeEventListener('touchend', onTouchEnd);
    container.removeEventListener('touchcancel', onTouchEnd);
    container.removeEventListener('mousedown', onMouseDown);
    container.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    container.removeEventListener('wheel', onWheel);

    map.dragPan.enable();
    map.dragRotate.enable();
    map.touchZoomRotate.enable();
    map.touchPitch.enable();
    map.scrollZoom.enable();
  };
}
