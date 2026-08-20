/* ---------------- Drawing the lot ----------------
   A manager traces the property once, and from then on a phone can tell whether
   somebody is standing on it.

   ---- Why a polygon, when the phone watches a circle ----
   A dealership is an L around a service drive, or a strip with the used lot
   across a side street. A circle drawn around that either swallows the road and
   the diner next door or cuts off half the inventory. So the shape a manager
   draws is a polygon, and the circle shown alongside it is the one the operating
   system will actually monitor — iOS and Android both refuse to watch anything
   else in the background. Crossing the circle is what wakes the app; the polygon
   is what the app then checks. Both are drawn here because a manager who cannot
   see the circle cannot understand why the app woke up at the kerb.

   ---- Leaflet is loaded only when this opens ----
   The map is a hundred kilobytes that a salesperson's phone, the TV board and
   every manager who never opens this screen would otherwise carry on every load.
   It is imported on mount instead, which costs a moment the first time and
   nothing afterwards.

   ---- No markers ----
   Leaflet's default marker is an image referenced by a path that every bundler
   rewrites and none of them get right, which is the single most common way a
   Leaflet map ships broken. Circle markers are drawn in SVG by Leaflet itself,
   so there is nothing to fetch and nothing to break.
*/
import React, { useEffect, useRef, useState, useCallback } from "react";
import { watchCircle, pointInPolygon, metersToEdge } from "../api/_geofence.mjs";

const OSM_TILES = "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
const OSM_CREDIT = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

/* Somewhere to start when a store has no fence and the browser will not say
   where it is: the middle of the dealership belt in Orlando. It is only ever the
   opening view — nothing is saved until a manager draws. */
const FALLBACK = { lat: 28.5383, lng: -81.3792 };

export default function FenceEditor({ store, fence, onSave, onCancel }) {
  const holder = useRef(null);
  const mapRef = useRef(null);
  const layers = useRef({ poly: null, circle: null, dots: [] });
  const [L, setL] = useState(null);
  const [ring, setRing] = useState(() => (fence && Array.isArray(fence.ring) ? fence.ring : []));
  const [msg, setMsg] = useState("");
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    let dead = false;
    (async () => {
      const mod = await import("leaflet");
      await import("leaflet/dist/leaflet.css");
      if (!dead) setL(mod.default || mod);
    })().catch(() => setMsg("The map could not be loaded. Check the connection and try again."));
    return () => { dead = true; };
  }, []);

  // Build the map once Leaflet is in hand.
  useEffect(() => {
    if (!L || !holder.current || mapRef.current) return;
    const start = ring.length ? ring[0] : (store && store.lat ? { lat: store.lat, lng: store.lng } : FALLBACK);
    const map = L.map(holder.current, { zoomControl: true, attributionControl: true })
      .setView([start.lat, start.lng], ring.length ? 17 : 15);
    L.tileLayer(OSM_TILES, { maxZoom: 19, attribution: OSM_CREDIT }).addTo(map);
    map.on("click", (e) => setRing((r) => [...r, { lat: +e.latlng.lat.toFixed(6), lng: +e.latlng.lng.toFixed(6) }]));
    mapRef.current = map;
    /* The container is sized by CSS that may not have settled when Leaflet
       measured it, which leaves the map rendered into a strip a few pixels tall
       with the tiles in the wrong place. */
    setTimeout(() => map.invalidateSize(), 60);
    return () => { map.remove(); mapRef.current = null; };
  }, [L]); // eslint-disable-line

  // Redraw the outline, its corners, and the circle the phone will watch.
  useEffect(() => {
    const map = mapRef.current;
    if (!L || !map) return;
    const l = layers.current;
    if (l.poly) { map.removeLayer(l.poly); l.poly = null; }
    if (l.circle) { map.removeLayer(l.circle); l.circle = null; }
    for (const d of l.dots) map.removeLayer(d);
    l.dots = [];

    if (ring.length >= 2) {
      l.poly = L.polygon(ring.map((p) => [p.lat, p.lng]), {
        color: "#0FB37E", weight: 3, fillColor: "#0FB37E", fillOpacity: 0.16,
      }).addTo(map);
    }
    if (ring.length >= 3) {
      const c = watchCircle(ring);
      l.circle = L.circle([c.lat, c.lng], {
        radius: c.radius, color: "#5566F0", weight: 1.5, dashArray: "6 6",
        fill: false, interactive: false,
      }).addTo(map);
    }
    ring.forEach((p, i) => {
      const dot = L.circleMarker([p.lat, p.lng], {
        radius: 7, color: "#fff", weight: 2, fillColor: "#0FB37E", fillOpacity: 1,
        draggable: false,
      }).addTo(map);
      dot.bindTooltip(`Corner ${i + 1} — tap to remove`, { direction: "top" });
      /* Tapping a corner removes it, and the click must not also reach the map
         underneath — or removing one corner would immediately add another in the
         same spot, which is what it did.

         The Leaflet event has to be the thing stopped, not the DOM event inside
         it. Leaflet decides whether to fire the map's own click by checking a
         flag it sets on ITS event object, so stopping the browser's event looks
         right, changes nothing, and leaves a corner that cannot be removed. */
      dot.on("click", (e) => {
        L.DomEvent.stopPropagation(e);
        setRing((r) => r.filter((_, k) => k !== i));
      });
      l.dots.push(dot);
    });
  }, [L, ring]);

  const useMyLocation = useCallback(() => {
    if (!navigator.geolocation) { setMsg("This browser will not share a location."); return; }
    setLocating(true); setMsg("");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const { latitude, longitude } = pos.coords;
        if (mapRef.current) mapRef.current.setView([latitude, longitude], 18);
      },
      () => { setLocating(false); setMsg("Your location was not shared, so the map stayed where it was."); },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  /* What a manager needs to know before saving, in the order it matters. */
  const circle = ring.length >= 3 ? watchCircle(ring) : null;
  const tooSmall = circle && circle.radius < 40;
  const huge = circle && circle.radius > 1200;

  const save = () => {
    if (ring.length < 3) { setMsg("A lot needs at least three corners."); return; }
    onSave({ ring, updatedAt: new Date().toISOString() });
  };

  return (
    <div className="fence">
      <div className="fence-head">
        <div>
          <h3>The lot</h3>
          <p className="hint">
            Tap the map at each corner of the property to trace it, and tap a corner again to take it
            off. The green shape is the lot. The dashed circle is what a phone can actually watch in
            the background — crossing it is what wakes the app, and the shape is what the app then
            checks, so the circle is always a little wider than the lot itself.
          </p>
        </div>
      </div>

      <div className="fence-map" ref={holder} />

      <div className="fence-bar">
        <button className="btn secondary" onClick={useMyLocation} disabled={locating}>
          {locating ? "Finding you…" : "Go to my location"}
        </button>
        <button className="btn secondary" disabled={!ring.length} onClick={() => setRing((r) => r.slice(0, -1))}>
          Undo last corner
        </button>
        <button className="btn secondary" disabled={!ring.length} onClick={() => setRing([])}>Start again</button>
        <span className="fence-count">
          {ring.length === 0 ? "No corners yet"
            : ring.length < 3 ? `${ring.length} corner${ring.length === 1 ? "" : "s"} — three at least`
            : `${ring.length} corners · watched circle ${circle.radius}m across the middle`}
        </span>
      </div>

      {tooSmall && (
        <p className="fence-warn">
          That is a very small area. A phone's own accuracy is routinely 10 to 40 metres, so a lot
          this size would spend most of its time being unsure — which means nobody would ever be
          marked off it.
        </p>
      )}
      {huge && (
        <p className="fence-warn">
          That circle is over a kilometre wide. It will still work, but the phone will wake up a long
          way from the lot, and anybody at a restaurant nearby may still count as being on it.
        </p>
      )}
      {msg && <p className="fence-warn">{msg}</p>}

      <div className="fence-acts">
        <button className="btn" onClick={save} disabled={ring.length < 3}>Save the lot</button>
        <button className="btn-quiet" onClick={onCancel}>Cancel</button>
        {fence && fence.ring && fence.ring.length >= 3 && (
          <button className="btn-x danger" onClick={() => onSave(null)}>Remove the fence</button>
        )}
      </div>
    </div>
  );
}

/* Exported for the tests: the sentence a manager should see about a point. */
export function describePoint(pt, ring) {
  if (!ring || ring.length < 3) return "No lot has been drawn yet.";
  const inside = pointInPolygon(pt, ring);
  const edge = Math.round(metersToEdge(pt, ring));
  return inside ? `On the lot, ${edge}m from the edge.` : `Off the lot, ${edge}m from the edge.`;
}
