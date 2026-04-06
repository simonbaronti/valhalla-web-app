/**
 * Embed mode utilities for HypaMaps CMS integration.
 *
 * When `?mode=embed` is in the URL, the Valhalla app runs in a simplified
 * configuration: pedestrian-only, no settings panel, no isochrones/tiles tabs,
 * and a "Save Route" button that posts the raw Valhalla JSON to the parent
 * window via postMessage.
 */

const params = new URLSearchParams(window.location.search);

/** True when the app is loaded inside an iframe with `?mode=embed` */
export const isEmbedMode = params.get('mode') === 'embed';

/** In embed mode, only the pedestrian profile is available */
export const embedProfile = 'pedestrian' as const;

/**
 * Send the raw Valhalla route JSON to the parent CMS window.
 * The CMS listens for `{ type: 'valhalla-route-saved' }` messages.
 */
export function postRouteToParent(routeJson: unknown) {
  if (!isEmbedMode) return;
  window.parent.postMessage(
    { type: 'valhalla-route-saved', data: routeJson },
    '*'
  );
}
