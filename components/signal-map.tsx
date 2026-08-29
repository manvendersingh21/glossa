"use client";

import { useEffect, useRef, useState } from "react";
import type {
  CircleLayerSpecification,
  ExpressionSpecification,
  GeoJSONSource,
  GeoJSONSourceSpecification,
  HeatmapLayerSpecification,
  Map as MapboxMap,
  MapMouseEvent,
  Popup as MapboxPopup,
  SymbolLayerSpecification,
} from "mapbox-gl";
import type { FeatureCollection, Point } from "geojson";
import type { SignalFeature } from "@/lib/contracts";
import type { Area, LayerMode } from "./dashboard-utils";
import { TIMING_COLORS, timingLabel } from "./dashboard-utils";

interface SignalMapProps {
  token: string;
  area: Area;
  mode: LayerMode;
  features: SignalFeature[];
  selectedFeature: SignalFeature | null;
  onSelect: (feature: SignalFeature) => void;
  onError: (message: string) => void;
}

interface MapFeatureProperties {
  id: string;
  name: string;
  timingKind: SignalFeature["properties"]["timing"]["kind"];
}

const SOURCE_ID = "signals";
const MAP_LAYERS = ["signal-clusters", "signal-cluster-count", "signal-heat", "signal-points", "signal-hit"];

const CAMERA: Record<Area, { center: [number, number]; zoom: number }> = {
  downtown: { center: [-122.4057, 37.7896], zoom: 13.55 },
  sf: { center: [-122.4376, 37.7665], zoom: 11.45 },
};

const timingColor: ExpressionSpecification = [
  "match",
  ["get", "timingKind"],
  "current_official",
  TIMING_COLORS.current_official,
  "stale_official",
  TIMING_COLORS.stale_official,
  "observed",
  TIMING_COLORS.observed,
  "modeled",
  TIMING_COLORS.modeled,
  TIMING_COLORS.unknown,
];

function mapData(features: SignalFeature[]): FeatureCollection<Point, MapFeatureProperties> {
  return {
    type: "FeatureCollection",
    features: features.map((feature) => ({
      type: "Feature",
      id: feature.id,
      geometry: feature.geometry,
      properties: {
        id: feature.properties.id,
        name: feature.properties.name,
        timingKind: feature.properties.timing.kind,
      },
    })),
  };
}

function removeDataLayers(map: MapboxMap) {
  for (const layer of MAP_LAYERS) {
    if (map.getLayer(layer)) map.removeLayer(layer);
  }
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
}

function addMapData(map: MapboxMap, mode: LayerMode, features: SignalFeature[]) {
  removeDataLayers(map);

  const source: GeoJSONSourceSpecification = {
    type: "geojson",
    data: mapData(features),
    cluster: mode === "clusters",
    clusterRadius: 46,
    clusterMaxZoom: 14,
  };
  map.addSource(SOURCE_ID, source);

  if (mode === "clusters") {
    const clusters: CircleLayerSpecification = {
      id: "signal-clusters",
      type: "circle",
      source: SOURCE_ID,
      filter: ["has", "point_count"],
      paint: {
        "circle-color": [
          "step",
          ["get", "point_count"],
          "#173b3c",
          16,
          "#245b58",
          48,
          "#087f72",
        ],
        "circle-radius": ["step", ["get", "point_count"], 18, 16, 23, 48, 29],
        "circle-stroke-color": "rgba(255,255,255,.92)",
        "circle-stroke-width": 2,
      },
    };
    const clusterCount: SymbolLayerSpecification = {
      id: "signal-cluster-count",
      type: "symbol",
      source: SOURCE_ID,
      filter: ["has", "point_count"],
      layout: {
        "text-field": ["get", "point_count_abbreviated"],
        "text-font": ["DIN Offc Pro Medium", "Arial Unicode MS Bold"],
        "text-size": 12,
      },
      paint: { "text-color": "#ffffff" },
    };
    const points: CircleLayerSpecification = {
      id: "signal-points",
      type: "circle",
      source: SOURCE_ID,
      filter: ["!", ["has", "point_count"]],
      paint: pointPaint(),
    };
    map.addLayer(clusters);
    map.addLayer(clusterCount);
    map.addLayer(points);
    return;
  }

  if (mode === "heatmap") {
    const heat: HeatmapLayerSpecification = {
      id: "signal-heat",
      type: "heatmap",
      source: SOURCE_ID,
      maxzoom: 18,
      paint: {
        "heatmap-weight": ["interpolate", ["linear"], ["zoom"], 9, 0.65, 16, 1],
        "heatmap-intensity": ["interpolate", ["linear"], ["zoom"], 9, 0.75, 15, 1.65],
        "heatmap-radius": ["interpolate", ["linear"], ["zoom"], 9, 16, 15, 32],
        "heatmap-opacity": ["interpolate", ["linear"], ["zoom"], 10, 0.78, 17, 0.44],
        "heatmap-color": [
          "interpolate",
          ["linear"],
          ["heatmap-density"],
          0,
          "rgba(8,127,114,0)",
          0.18,
          "#b8ddd2",
          0.42,
          "#55ad98",
          0.7,
          "#087f72",
          1,
          "#173b3c",
        ],
      },
    };
    const hitTarget: CircleLayerSpecification = {
      id: "signal-hit",
      type: "circle",
      source: SOURCE_ID,
      paint: {
        "circle-radius": 12,
        "circle-color": "#000000",
        "circle-opacity": 0.01,
      },
    };
    map.addLayer(heat);
    map.addLayer(hitTarget);
    return;
  }

  const points: CircleLayerSpecification = {
    id: "signal-points",
    type: "circle",
    source: SOURCE_ID,
    paint: pointPaint(),
  };
  map.addLayer(points);
}

function pointPaint(): CircleLayerSpecification["paint"] {
  return {
    "circle-radius": ["interpolate", ["linear"], ["zoom"], 9, 3.5, 15, 7.5],
    "circle-color": timingColor,
    "circle-stroke-color": "rgba(255,255,255,.96)",
    "circle-stroke-width": ["interpolate", ["linear"], ["zoom"], 9, 1, 15, 2],
    "circle-opacity": 0.92,
  };
}

export function SignalMap({
  token,
  area,
  mode,
  features,
  selectedFeature,
  onSelect,
  onError,
}: SignalMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapboxMap | null>(null);
  const popupRef = useRef<MapboxPopup | null>(null);
  const mapboxRef = useRef<typeof import("mapbox-gl")["default"] | null>(null);
  const featuresRef = useRef(features);
  const onSelectRef = useRef(onSelect);
  const onErrorRef = useRef(onError);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    featuresRef.current = features;
  }, [features]);

  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  useEffect(() => {
    let cancelled = false;
    let resizeObserver: ResizeObserver | null = null;

    async function createMap() {
      if (!containerRef.current) return;
      try {
        const imported = await import("mapbox-gl");
        if (cancelled || !containerRef.current) return;
        const mapboxgl = imported.default;
        mapboxgl.accessToken = token;
        mapboxRef.current = mapboxgl;

        const camera = CAMERA.downtown;
        const map = new mapboxgl.Map({
          container: containerRef.current,
          style: "mapbox://styles/mapbox/light-v11",
          center: camera.center,
          zoom: camera.zoom,
          minZoom: 9,
          maxZoom: 19,
          attributionControl: true,
          logoPosition: "bottom-left",
          renderWorldCopies: false,
          cooperativeGestures: true,
          fadeDuration: 0,
        });
        mapRef.current = map;
        map.addControl(new mapboxgl.NavigationControl({ showCompass: false }), "bottom-right");

        let styleLoaded = false;
        map.on("load", () => {
          styleLoaded = true;
          if (!cancelled) {
            onErrorRef.current("");
            setMapReady(true);
          }
        });
        map.on("error", (event) => {
          if (!styleLoaded && !cancelled) {
            onErrorRef.current(event.error?.message || "The Mapbox style could not be loaded.");
          }
        });

        map.on("click", (event: MapMouseEvent) => {
          const clusterLayer = map.getLayer("signal-clusters") ? ["signal-clusters"] : [];
          if (clusterLayer.length) {
            const cluster = map.queryRenderedFeatures(event.point, { layers: clusterLayer })[0];
            if (cluster) {
              const clusterId = Number(cluster.properties?.cluster_id);
              const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
              if (source && Number.isFinite(clusterId)) {
                source.getClusterExpansionZoom(clusterId, (error, zoom) => {
                  if (!error && zoom !== null && zoom !== undefined && cluster.geometry.type === "Point") {
                    map.jumpTo({ center: cluster.geometry.coordinates as [number, number], zoom });
                  }
                });
              }
              return;
            }
          }

          const interactiveLayers = ["signal-points", "signal-hit"].filter((id) => map.getLayer(id));
          if (!interactiveLayers.length) return;
          const hit = map.queryRenderedFeatures(event.point, { layers: interactiveLayers })[0];
          const id = hit?.properties?.id;
          if (typeof id !== "string") return;
          const selected = featuresRef.current.find((feature) => feature.properties.id === id);
          if (selected) onSelectRef.current(selected);
        });

        map.on("mousemove", (event: MapMouseEvent) => {
          const interactiveLayers = ["signal-clusters", "signal-points", "signal-hit"].filter((id) =>
            map.getLayer(id),
          );
          const isInteractive = interactiveLayers.length
            ? map.queryRenderedFeatures(event.point, { layers: interactiveLayers }).length > 0
            : false;
          map.getCanvas().style.cursor = isInteractive ? "pointer" : "";
        });

        resizeObserver = new ResizeObserver(() => map.resize());
        resizeObserver.observe(containerRef.current);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Mapbox could not initialize.";
        onErrorRef.current(message);
      }
    }

    void createMap();
    return () => {
      cancelled = true;
      resizeObserver?.disconnect();
      popupRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [token]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    addMapData(map, mode, features);
  }, [features, mapReady, mode]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.jumpTo(CAMERA[area]);
  }, [area, mapReady]);

  useEffect(() => {
    popupRef.current?.remove();
    popupRef.current = null;
    const map = mapRef.current;
    const mapboxgl = mapboxRef.current;
    if (!map || !mapboxgl || !mapReady || !selectedFeature) return;

    const content = document.createElement("div");
    content.className = "map-popup-content";
    content.setAttribute("role", "tooltip");
    const eyebrow = document.createElement("span");
    eyebrow.className = `map-popup-status timing-${selectedFeature.properties.timing.kind}`;
    eyebrow.textContent = timingLabel(selectedFeature.properties.timing.kind);
    const title = document.createElement("strong");
    title.textContent = selectedFeature.properties.name;
    const hint = document.createElement("span");
    hint.textContent = "Details open";
    content.append(eyebrow, title, hint);

    const popup = new mapboxgl.Popup({ closeButton: false, closeOnClick: false, offset: 14 })
      .setLngLat(selectedFeature.geometry.coordinates)
      .setDOMContent(content)
      .addTo(map);
    popupRef.current = popup;
    return () => {
      popup.remove();
    };
  }, [mapReady, selectedFeature]);

  return (
    <div
      ref={containerRef}
      className="signal-map"
      aria-label={`Map of ${features.length} filtered traffic signals in ${
        area === "downtown" ? "downtown San Francisco" : "San Francisco"
      }`}
    />
  );
}
