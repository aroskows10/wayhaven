import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import {
  Map as MLMap,
  Camera,
  UserLocation,
  GeoJSONSource,
  Layer,
  Marker,
  ViewAnnotation,
  type CameraRef,
} from "@maplibre/maplibre-react-native";
import * as Location from "expo-location";
import { useTheme } from "../../../context/ThemeContext";
import { useUnits } from "../../../context/UnitsContext";

const MAP_STYLE_LIGHT = "https://tiles.openfreemap.org/styles/liberty";
const MAP_STYLE_DARK = "https://tiles.openfreemap.org/styles/dark";

interface Suggestion {
  osm_id: number;
  osm_type: string;
  name: string;
  full_address: string;
  longitude: number;
  latitude: number;
  poi_category?: string[];
  address?: string;
  place_formatted?: string;
  city?: string;
}

interface SelectedPlace {
  name: string;
  longitude: number;
  latitude: number;
  poi_category?: string[];
  address?: string;
  place_formatted?: string;
  city?: string;
}

interface RouteStep {
  distance: number;
  duration: number;
  name: string;
  maneuver: { type: string; modifier?: string; location: [number, number] };
}

/** Equirectangular distance between two [lon, lat] points in meters */
const distanceMeters = (a: [number, number], b: [number, number]): number => {
  const toRad = Math.PI / 180;
  const dLat = (b[1] - a[1]) * toRad;
  const dLon = (b[0] - a[0]) * toRad;
  const avgLat = ((a[1] + b[1]) / 2) * toRad;
  const x = dLon * Math.cos(avgLat);
  return Math.sqrt(x * x + dLat * dLat) * 6_371_000;
};

/** Minimum distance (meters) from a [lon,lat] point to a polyline of [lon,lat][] */
const distanceToLine = (
  point: [number, number],
  polyline: [number, number][]
): number => {
  let min = Infinity;
  for (let i = 0; i < polyline.length - 1; i++) {
    const a = polyline[i];
    const b = polyline[i + 1];
    // Project point onto segment a→b
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const lenSq = dx * dx + dy * dy;
    let t = lenSq === 0 ? 0 : ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const proj: [number, number] = [a[0] + t * dx, a[1] + t * dy];
    const d = distanceMeters(point, proj);
    if (d < min) min = d;
  }
  return min;
};

const getManeuverIcon = (maneuver: { type: string; modifier?: string }): keyof typeof MaterialIcons.glyphMap => {
  const { type, modifier } = maneuver;
  if (type === "depart") return "trip-origin";
  if (type === "arrive") return "place";
  if (type === "merge") return "merge";
  if (type === "roundabout" || type === "rotary") {
    if (modifier?.includes("right")) return "roundabout-right";
    return "roundabout-left";
  }
  if (type === "fork") {
    if (modifier?.includes("right")) return "fork-right";
    return "fork-left";
  }
  if (type === "turn" || type === "end of road" || type === "new name") {
    if (modifier === "left") return "turn-left";
    if (modifier === "right") return "turn-right";
    if (modifier === "sharp left") return "turn-sharp-left";
    if (modifier === "sharp right") return "turn-sharp-right";
    if (modifier === "slight left") return "turn-slight-left";
    if (modifier === "slight right") return "turn-slight-right";
    if (modifier === "uturn") return "u-turn-left";
    return "straight";
  }
  return "straight";
};

const getStepInstruction = (step: RouteStep): string => {
  const { type, modifier } = step.maneuver;
  const street = step.name && step.name !== "" ? step.name : "the road";

  if (type === "depart") return `Head on ${street}`;
  if (type === "arrive") return "Arrive at destination";

  const directionMap: Record<string, string> = {
    left: "Turn left",
    right: "Turn right",
    "sharp left": "Turn sharp left",
    "sharp right": "Turn sharp right",
    "slight left": "Turn slight left",
    "slight right": "Turn slight right",
    uturn: "Make a U-turn",
    straight: "Continue straight",
  };

  if (type === "roundabout" || type === "rotary") {
    return `Take the roundabout onto ${street}`;
  }
  if (type === "fork") {
    const dir = modifier?.includes("right") ? "right" : "left";
    return `Take the ${dir} fork onto ${street}`;
  }
  if (type === "merge") {
    return `Merge onto ${street}`;
  }

  const action = modifier ? directionMap[modifier] ?? "Continue" : "Continue";
  return `${action} onto ${street}`;
};

export default function MapScreen() {
  const { colorScheme } = useTheme();
  const { unitPreference } = useUnits();
  const isDark = colorScheme === "dark";

  const DEFAULT_ZOOM = 12;
  const [locationGranted, setLocationGranted] = useState(false);
  const [followUser, setFollowUser] = useState(true);
  const [currentZoom, setCurrentZoom] = useState(DEFAULT_ZOOM);

  const [searchText, setSearchText] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [previewPins, setPreviewPins] = useState<Suggestion[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<SelectedPlace | null>(null);

  type RouteProfile = "driving" | "walking" | "cycling";
  const [routeGeoJSON, setRouteGeoJSON] = useState<GeoJSON.LineString | null>(null);
  const [routeProfile, setRouteProfile] = useState<RouteProfile>("driving");
  const [routeDuration, setRouteDuration] = useState<number | null>(null);
  const [routeDistance, setRouteDistance] = useState<number | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);

  const [stops, setStops] = useState<SelectedPlace[]>([]);
  const [addingStop, setAddingStop] = useState(false);

  const [routeSteps, setRouteSteps] = useState<RouteStep[]>([]);
  const [isNavigating, setIsNavigating] = useState(false);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);

  const searchInputRef = useRef<TextInput>(null);
  const bottomSheetHeight = useRef(300);

  const searchTextRef = useRef(searchText);
  searchTextRef.current = searchText;
  const selectedPlaceRef = useRef<SelectedPlace | null>(selectedPlace);
  selectedPlaceRef.current = selectedPlace;
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  // Mirror refs for location watcher callback (avoids effect re-runs)
  const routeStepsRef = useRef(routeSteps);
  routeStepsRef.current = routeSteps;
  const currentStepIndexRef = useRef(currentStepIndex);
  currentStepIndexRef.current = currentStepIndex;
  const isNavigatingRef = useRef(isNavigating);
  isNavigatingRef.current = isNavigating;
  const routeGeoJSONRef = useRef(routeGeoJSON);
  routeGeoJSONRef.current = routeGeoJSON;
  const routeProfileRef = useRef(routeProfile);
  routeProfileRef.current = routeProfile;

  // Location watcher state
  const locationSubRef = useRef<Location.LocationSubscription | null>(null);
  const lastRerouteRef = useRef<number>(0);
  const isReroutingRef = useRef(false);

  const lastRecenterRef = useRef<number>(0);
  const cameraRef = useRef<CameraRef>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mapStateRef = useRef<{
    lon: number;
    lat: number;
    bounds: [number, number, number, number] | null; // [west, south, east, north]
    zoom: number;
  } | null>(null);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        setLocationGranted(true);
      }
    })();
  }, []);

  // Location watcher: auto-advance steps, camera follow, off-route reroute
  useEffect(() => {
    if (!isNavigating || !locationGranted) {
      // Cleanup when navigation stops
      if (locationSubRef.current) {
        locationSubRef.current.remove();
        locationSubRef.current = null;
      }
      return;
    }

    let cancelled = false;

    (async () => {
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 2000,
          distanceInterval: 5,
        },
        (loc) => {
          if (cancelled) return;
          const userPos: [number, number] = [loc.coords.longitude, loc.coords.latitude];

          // 1. Camera tracking — smooth follow
          cameraRef.current?.flyTo({
            center: userPos,
            zoom: 17,
            duration: 1000,
          });

          const steps = routeStepsRef.current;
          const stepIdx = currentStepIndexRef.current;

          if (steps.length === 0) return;

          // 2. Auto-advance — check distance to next step's maneuver
          if (stepIdx < steps.length - 1) {
            const nextManeuver = steps[stepIdx + 1].maneuver.location;
            const dist = distanceMeters(userPos, nextManeuver);
            if (dist < 30) {
              setCurrentStepIndex(stepIdx + 1);
            }
          } else {
            // On last step — check if near final maneuver to auto-end
            const finalManeuver = steps[stepIdx].maneuver.location;
            const dist = distanceMeters(userPos, finalManeuver);
            if (dist < 30) {
              setIsNavigating(false);
              setCurrentStepIndex(0);
              setFollowUser(true);
              return;
            }
          }

          // 3. Off-route detection & reroute
          const geo = routeGeoJSONRef.current;
          if (!geo) return;
          const routeCoords = geo.coordinates as [number, number][];
          const offDist = distanceToLine(userPos, routeCoords);
          if (
            offDist > 50 &&
            !isReroutingRef.current &&
            Date.now() - lastRerouteRef.current > 15_000
          ) {
            isReroutingRef.current = true;
            lastRerouteRef.current = Date.now();
            setCurrentStepIndex(0);
            fetchRoute(routeProfileRef.current).finally(() => {
              isReroutingRef.current = false;
            });
          }
        }
      );
      if (cancelled) {
        sub.remove();
      } else {
        locationSubRef.current = sub;
      }
    })();

    return () => {
      cancelled = true;
      if (locationSubRef.current) {
        locationSubRef.current.remove();
        locationSubRef.current = null;
      }
    };
  }, [isNavigating, locationGranted]);

  // Debounced search using Photon geocoder
  const geocode = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.length < 2) {
      setSuggestions([]);
      setPreviewPins([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      // Cancel any in-flight request so stale results never overwrite fresh ones
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      try {
        const coords = mapStateRef.current;
        const proximity = coords
          ? `&lat=${coords.lat}&lon=${coords.lon}`
          : "";
        const url = `https://photon.komoot.io/api?q=${encodeURIComponent(
          query
        )}&limit=10${proximity}&lang=en`;
        const res = await fetch(url, { signal: controller.signal });
        const data = await res.json();

        if (data.features) {
          const results: Suggestion[] = data.features.map(
            (f: any) => {
              const props = f.properties ?? {};
              const [lon, lat] = f.geometry.coordinates;
              const addressParts = [props.street, props.housenumber].filter(Boolean);
              const placeParts = [props.city, props.state, props.country].filter(Boolean);
              return {
                osm_id: props.osm_id,
                osm_type: props.osm_type ?? "N",
                name: props.name ?? "Unknown",
                full_address: placeParts.join(", ") || props.name || "Unknown",
                longitude: lon,
                latitude: lat,
                poi_category: props.osm_value ? [props.osm_value] : undefined,
                address: addressParts.length > 0 ? addressParts.join(" ") : undefined,
                place_formatted: placeParts.join(", ") || undefined,
                city: props.city ?? undefined,
              } as Suggestion;
            }
          );
          setSuggestions(results);
          setPreviewPins(results);
          setSelectedPlace(null);

          // Auto-zoom: if #1 result is outside current map bounds, fit to include it
          if (results.length > 0 && mapStateRef.current?.bounds) {
            const best = results[0];
            const [west, south, east, north] = mapStateRef.current.bounds;
            const inBounds =
              best.longitude >= west &&
              best.longitude <= east &&
              best.latitude >= south &&
              best.latitude <= north;

            if (!inBounds) {
              const center = mapStateRef.current;
              cameraRef.current?.fitBounds(
                [
                  Math.min(center.lon, best.longitude) - 0.01,
                  Math.min(center.lat, best.latitude) - 0.01,
                  Math.max(center.lon, best.longitude) + 0.01,
                  Math.max(center.lat, best.latitude) + 0.01,
                ],
                { padding: { top: 80, right: 80, bottom: 80, left: 80 }, duration: 1500 }
              );
            }
          }
        }
      } catch {
        // silently ignore network errors
      }
    }, 300);
  }, []);

  const onChangeSearch = (text: string) => {
    setSearchText(text);
    if (text.length === 0) {
      setSuggestions([]);
      setPreviewPins([]);
      setSelectedPlace(null);
    } else {
      geocode(text);
    }
  };

  const onSelectSuggestion = (suggestion: Suggestion) => {
    setSuggestions([]);
    Keyboard.dismiss();

    const place: SelectedPlace = {
      name: suggestion.name,
      longitude: suggestion.longitude,
      latitude: suggestion.latitude,
      poi_category: suggestion.poi_category,
      address: suggestion.address,
      place_formatted: suggestion.place_formatted,
      city: suggestion.city,
    };

    // Route mode: append as a new stop
    if (stopsRef.current.length > 0 || addingStop) {
      const newStops = [...stopsRef.current, place];
      setStops(newStops);
      setAddingStop(false);
      setSearchText("");
      fetchRoute(routeProfile, newStops);
      return;
    }

    // Browsing mode: select place
    setSearchText(suggestion.full_address);
    setSelectedPlace(place);
    setFollowUser(false);
    cameraRef.current?.flyTo({
      center: [place.longitude, place.latitude],
      zoom: 14,
      duration: 1500,
    });
  };

  const clearRoute = () => {
    setRouteGeoJSON(null);
    setRouteDuration(null);
    setRouteDistance(null);
    setRouteSteps([]);
    setIsNavigating(false);
    setCurrentStepIndex(0);
    setFollowUser(true);
  };

  const osrmBaseUrl: Record<RouteProfile, string> = {
    driving: "https://routing.openstreetmap.de/routed-car/route/v1/driving",
    walking: "https://routing.openstreetmap.de/routed-foot/route/v1/driving",
    cycling: "https://routing.openstreetmap.de/routed-bike/route/v1/driving",
  };

  const fetchRoute = async (profile: RouteProfile, overrideStops?: SelectedPlace[]) => {
    const routeStops = overrideStops ?? stopsRef.current;
    if (routeStops.length === 0) return;
    setRouteProfile(profile);
    setLoadingRoute(true);
    try {
      const pos = await Location.getCurrentPositionAsync({});
      const userLon = pos.coords.longitude;
      const userLat = pos.coords.latitude;

      const waypoints = [
        `${userLon},${userLat}`,
        ...routeStops.map((s) => `${s.longitude},${s.latitude}`),
      ].join(";");

      const url = `${osrmBaseUrl[profile]}/${waypoints}?geometries=geojson&overview=full&steps=true`;
      const res = await fetch(url);
      const data = await res.json();
      const route = data.routes?.[0];
      if (!route) return;

      setRouteGeoJSON(route.geometry);
      setRouteDuration(route.duration);
      setRouteDistance(route.distance);

      // Extract turn-by-turn steps from all legs
      const allSteps: RouteStep[] = [];
      for (const leg of route.legs ?? []) {
        for (const step of leg.steps ?? []) {
          allSteps.push({
            distance: step.distance,
            duration: step.duration,
            name: step.name ?? "",
            maneuver: {
              type: step.maneuver?.type ?? "turn",
              modifier: step.maneuver?.modifier,
              location: step.maneuver?.location ?? [0, 0],
            },
          });
        }
      }
      setRouteSteps(allSteps);

      // Fit camera to show full route
      const coords = route.geometry.coordinates as [number, number][];
      let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const [lon, lat] of coords) {
        if (lon < minLon) minLon = lon;
        if (lon > maxLon) maxLon = lon;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
      }
      const pad = bottomSheetHeight.current + 40;
      cameraRef.current?.fitBounds(
        [minLon, minLat, maxLon, maxLat],
        { padding: { top: 80, right: 40, bottom: pad, left: 40 }, duration: 1500 }
      );
      setFollowUser(false);
    } catch {
      // silently ignore errors
    } finally {
      setLoadingRoute(false);
    }
  };

  const formatDuration = (seconds: number) => {
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.round((seconds % 3600) / 60);
    return mins > 0 ? `${hrs} hr ${mins} min` : `${hrs} hr`;
  };

  const formatDistance = (meters: number) => {
    if (unitPreference === "km") {
      return `${(meters / 1000).toFixed(1)} km`;
    }
    return `${(meters / 1609.34).toFixed(1)} mi`;
  };

  const routeLineColor: Record<RouteProfile, string> = {
    driving: "#4A89F3",
    walking: "#34A853",
    cycling: "#FF9500",
  };

  const onClearSearch = () => {
    if (addingStop || stops.length > 0) {
      setSearchText("");
      setSuggestions([]);
      setPreviewPins([]);
      setAddingStop(false);
      if (routeGeoJSON) {
        const coords = routeGeoJSON.coordinates as [number, number][];
        let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
        for (const [lon, lat] of coords) {
          if (lon < minLon) minLon = lon;
          if (lon > maxLon) maxLon = lon;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
        const pad = bottomSheetHeight.current + 40;
        cameraRef.current?.fitBounds(
          [minLon, minLat, maxLon, maxLat],
          { padding: { top: 80, right: 40, bottom: pad, left: 40 }, duration: 1500 }
        );
      }
      return;
    }
    setSearchText("");
    setSuggestions([]);
    setPreviewPins([]);
    setSelectedPlace(null);
    clearRoute();
  };

  const startDirections = () => {
    if (!selectedPlace) return;
    const newStops = [selectedPlace];
    setStops(newStops);
    setSelectedPlace(null);
    fetchRoute("driving", newStops);
  };

  const removeStop = (index: number) => {
    const newStops = stops.filter((_, i) => i !== index);
    setStops(newStops);
    if (newStops.length === 0) {
      clearRoute();
      setFollowUser(true);
    } else {
      fetchRoute(routeProfile, newStops);
    }
  };

  const reorderStop = (index: number, direction: "up" | "down") => {
    const target = direction === "up" ? index - 1 : index + 1;
    if (target < 0 || target >= stops.length) return;
    const newStops = [...stops];
    [newStops[index], newStops[target]] = [newStops[target], newStops[index]];
    setStops(newStops);
    fetchRoute(routeProfile, newStops);
  };

  const addStopFromSuggestion = (s: Suggestion) => {
    const place: SelectedPlace = {
      name: s.name,
      longitude: s.longitude,
      latitude: s.latitude,
      poi_category: s.poi_category,
      address: s.address,
      place_formatted: s.place_formatted,
      city: s.city,
    };
    const newStops = [...stops, place];
    setStops(newStops);
    fetchRoute(routeProfile, newStops);
  };

  const onMapTouch = () => {
    setFollowUser(false);
    Keyboard.dismiss();
    setSuggestions([]);
  };

  // Theme colors
  const barBg = isDark ? "#222" : "#fff";
  const barText = isDark ? "#eee" : "#111";
  const barPlaceholder = isDark ? "#888" : "#999";
  const barBorder = isDark ? "#444" : "#ccc";

  const suggBg = isDark ? "#333" : "#fff";
  const suggText = isDark ? "#ddd" : "#222";
  const suggBorder = isDark ? "#555" : "#ddd";

  return (
    <SafeAreaView
      style={[styles.container, { backgroundColor: isDark ? "#111" : "#fff" }]}
    >
      <MLMap
        style={styles.map}
        compass={true}
        compassHiddenFacingNorth={false}
        compassPosition={{ top: 85, right: 10 }}
        scaleBarPosition={{ top: 5, left: 13 }}
        mapStyle={isDark ? MAP_STYLE_DARK : MAP_STYLE_LIGHT}
        onPress={onMapTouch}
        onRegionDidChange={(e) => {
          const { center, bounds, zoom, userInteraction } = e.nativeEvent;
          mapStateRef.current = {
            lon: center[0],
            lat: center[1],
            bounds: bounds ?? null,
            zoom,
          };
          setCurrentZoom(zoom);

          if (userInteraction) {
            setFollowUser(false);
            Keyboard.dismiss();
            setSuggestions([]);
          }
        }}
      >
        {locationGranted && (
          <>
            <Camera
              ref={cameraRef}
              trackUserLocation={followUser ? "default" : undefined}
              zoom={12}
            />
            <UserLocation />
          </>
        )}

        {/* Preview pins for search results — hide pins that are already stops */}
        {previewPins
          .filter(
            (s) =>
              !stops.some(
                (st) => st.longitude === s.longitude && st.latitude === s.latitude
              )
          )
          .map((s) => {
            const isSelected =
              selectedPlace &&
              s.longitude === selectedPlace.longitude &&
              s.latitude === selectedPlace.latitude;
            return (
              <ViewAnnotation
                key={`preview-${s.osm_type}-${s.osm_id}`}
                id={`preview-${s.osm_type}-${s.osm_id}`}
                lngLat={[s.longitude, s.latitude]}
                anchor="bottom"
                onSelect={() => {
                  if (stops.length > 0) {
                    addStopFromSuggestion(s);
                  } else {
                    const place: SelectedPlace = {
                      name: s.name,
                      longitude: s.longitude,
                      latitude: s.latitude,
                      poi_category: s.poi_category,
                      address: s.address,
                      place_formatted: s.place_formatted,
                      city: s.city,
                    };
                    const newStops = [place];
                    setStops(newStops);
                    setSelectedPlace(null);
                    fetchRoute("driving", newStops);
                  }
                }}
              >
                <View style={styles.pin}>
                  <MaterialIcons
                    name="place"
                    size={isSelected ? 36 : 28}
                    color={isSelected ? "#e74c3c" : "#aaa"}
                  />
                </View>
              </ViewAnnotation>
            );
          })}

        {/* Fallback selected pin — only when not in preview pins */}
        {selectedPlace &&
          !previewPins.some(
            (s) =>
              s.longitude === selectedPlace.longitude &&
              s.latitude === selectedPlace.latitude
          ) && (
            <ViewAnnotation
              id="selected-pin"
              lngLat={[selectedPlace.longitude, selectedPlace.latitude]}
              anchor="bottom"
            >
              <View style={styles.pin}>
                <MaterialIcons name="place" size={36} color="#e74c3c" />
              </View>
            </ViewAnnotation>
          )}

        {routeGeoJSON && (
          <GeoJSONSource
            id="routeSource"
            data={{ type: "Feature", properties: {}, geometry: routeGeoJSON }}
          >
            <Layer
              id="routeLine"
              type="line"
              paint={{
                "line-color": routeLineColor[routeProfile],
                "line-width": 4,
              }}
              layout={{
                "line-cap": "round",
                "line-join": "round",
              }}
            />
          </GeoJSONSource>
        )}

        {/* Numbered stop markers — rendered as a circle+symbol layer so they draw above the route */}
        {stops.length > 0 && (
          <GeoJSONSource
            id="stopsSource"
            data={{
              type: "FeatureCollection",
              features: stops.map((stop, i) => ({
                type: "Feature" as const,
                properties: { label: String(i + 1) },
                geometry: {
                  type: "Point" as const,
                  coordinates: [stop.longitude, stop.latitude],
                },
              })),
            }}
          >
            <Layer
              id="stopsCircle"
              type="circle"
              afterId="routeLine"
              paint={{
                "circle-radius": 14,
                "circle-color": "#e74c3c",
              }}
            />
            <Layer
              id="stopsLabel"
              type="symbol"
              afterId="stopsCircle"
              layout={{
                "text-field": ["get", "label"],
                "text-size": 13,
                "text-allow-overlap": true,
                "icon-allow-overlap": true,
              }}
              paint={{
                "text-color": "#ffffff",
              }}
            />
          </GeoJSONSource>
        )}
      </MLMap>

      {/* Search bar — hidden during navigation */}
      {!isNavigating && (
        <View
          style={[
            styles.searchBar,
            { backgroundColor: barBg, borderColor: barBorder },
          ]}
        >
          <MaterialIcons
            name="search"
            size={22}
            color={barPlaceholder}
            style={{ marginRight: 6 }}
          />
          <TextInput
            ref={searchInputRef}
            style={[styles.searchInput, { color: barText }]}
            placeholder="Search places..."
            placeholderTextColor={barPlaceholder}
            value={searchText}
            onChangeText={onChangeSearch}
            returnKeyType="search"
          />
          {searchText.length > 0 && (
            <Pressable onPress={onClearSearch} hitSlop={8}>
              <MaterialIcons name="close" size={20} color={barPlaceholder} />
            </Pressable>
          )}
        </View>
      )}

      {/* Suggestions dropdown — hidden during navigation */}
      {!isNavigating && suggestions.length > 0 && (
        <View
          style={[
            styles.suggestionsContainer,
            { backgroundColor: suggBg, borderColor: suggBorder },
          ]}
        >
          <FlatList
            data={suggestions}
            keyExtractor={(item) => `${item.osm_type}-${item.osm_id}`}
            keyboardShouldPersistTaps="handled"
            renderItem={({ item }) => (
              <Pressable
                style={({ pressed }) => [
                  styles.suggestionRow,
                  { borderBottomColor: suggBorder, opacity: pressed ? 0.5 : 1 },
                ]}
                onPress={() => onSelectSuggestion(item)}
              >
                <MaterialIcons
                  name="place"
                  size={18}
                  color={isDark ? "#aaa" : "#666"}
                  style={{ marginRight: 8 }}
                />
                <View style={{ flex: 1 }}>
                  <Text
                    style={[styles.suggestionText, { color: suggText }]}
                    numberOfLines={1}
                  >
                    {item.name}
                  </Text>
                  <Text
                    style={[styles.suggestionSubtext, { color: barPlaceholder }]}
                    numberOfLines={1}
                  >
                    {item.full_address}
                  </Text>
                </View>
              </Pressable>
            )}
          />
        </View>
      )}

      {/* Browsing mode bottom sheet — place info */}
      {selectedPlace && stops.length === 0 && (
        <View
          onLayout={(e) => { bottomSheetHeight.current = e.nativeEvent.layout.height; }}
          style={[
            styles.bottomSheet,
            { backgroundColor: isDark ? "#222" : "#fff", borderColor: isDark ? "#444" : "#ccc" },
          ]}
        >
          <Text style={[styles.bottomSheetName, { color: isDark ? "#eee" : "#111" }]}>
            {selectedPlace.name}
          </Text>
          {selectedPlace.poi_category && selectedPlace.poi_category.length > 0 && (
            <View style={styles.categoryRow}>
              {selectedPlace.poi_category.map((cat) => (
                <View
                  key={cat}
                  style={[
                    styles.categoryTag,
                    { backgroundColor: isDark ? "#444" : "#e8e8e8" },
                  ]}
                >
                  <Text style={[styles.categoryText, { color: isDark ? "#ccc" : "#555" }]}>
                    {cat}
                  </Text>
                </View>
              ))}
            </View>
          )}
          {(selectedPlace.address || selectedPlace.place_formatted) && (
            <Text
              style={[styles.bottomSheetAddress, { color: isDark ? "#aaa" : "#666" }]}
              numberOfLines={2}
            >
              {selectedPlace.address ?? selectedPlace.place_formatted}
            </Text>
          )}
          {selectedPlace.city && (
            <Text style={[styles.bottomSheetCity, { color: isDark ? "#999" : "#888" }]}>
              {selectedPlace.city}
            </Text>
          )}
          <Pressable
            style={({ pressed }) => [
              styles.directionsButton,
              {
                backgroundColor: isDark ? "#2a4a6a" : "#4A89F3",
                opacity: pressed || loadingRoute ? 0.7 : 1,
              },
            ]}
            onPress={startDirections}
            disabled={loadingRoute}
          >
            {loadingRoute ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <MaterialIcons name="directions" size={20} color="#fff" style={{ marginRight: 6 }} />
                <Text style={styles.directionsButtonText}>Directions</Text>
              </>
            )}
          </Pressable>
        </View>
      )}

      {/* Route mode bottom sheet — stops list */}
      {stops.length > 0 && !isNavigating && (
        <View
          onLayout={(e) => { bottomSheetHeight.current = e.nativeEvent.layout.height; }}
          style={[
            styles.bottomSheet,
            { backgroundColor: isDark ? "#222" : "#fff", borderColor: isDark ? "#444" : "#ccc" },
          ]}
        >
          {/* Mode selector */}
          <View style={styles.modeRow}>
            {([
              { profile: "driving" as RouteProfile, icon: "directions-car" as const },
              { profile: "walking" as RouteProfile, icon: "directions-walk" as const },
              { profile: "cycling" as RouteProfile, icon: "directions-bike" as const },
            ]).map(({ profile, icon }) => (
              <Pressable
                key={profile}
                onPress={() => fetchRoute(profile)}
                disabled={loadingRoute}
                style={({ pressed }) => [
                  styles.modeButton,
                  {
                    backgroundColor:
                      routeProfile === profile
                        ? routeLineColor[profile]
                        : isDark ? "#333" : "#eee",
                    opacity: pressed ? 0.6 : loadingRoute && routeProfile !== profile ? 0.5 : 1,
                  },
                ]}
              >
                {loadingRoute && routeProfile === profile ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <MaterialIcons
                    name={icon}
                    size={22}
                    color={routeProfile === profile ? "#fff" : isDark ? "#aaa" : "#555"}
                  />
                )}
              </Pressable>
            ))}
          </View>

          {routeDuration != null && routeDistance != null && (
            <Text style={[styles.routeInfo, { color: isDark ? "#ccc" : "#444" }]}>
              {formatDuration(routeDuration)}  ·  {formatDistance(routeDistance)}
            </Text>
          )}

          {/* Stops list */}
          <ScrollView style={styles.stopsScroll}>
            {stops.map((stop, i) => (
              <View
                key={`${i}-${stop.longitude}-${stop.latitude}`}
                style={[styles.stopRow, { borderBottomColor: isDark ? "#444" : "#eee" }]}
              >
                <View style={styles.stopMarkerSmall}>
                  <Text style={styles.stopMarkerSmallText}>{i + 1}</Text>
                </View>
                <Text
                  style={[styles.stopName, { color: isDark ? "#ddd" : "#222" }]}
                  numberOfLines={1}
                >
                  {stop.name}
                </Text>
                {i > 0 && (
                  <Pressable
                    onPress={() => reorderStop(i, "up")}
                    hitSlop={6}
                    style={styles.stopControl}
                  >
                    <MaterialIcons name="arrow-upward" size={18} color={isDark ? "#aaa" : "#666"} />
                  </Pressable>
                )}
                {i < stops.length - 1 && (
                  <Pressable
                    onPress={() => reorderStop(i, "down")}
                    hitSlop={6}
                    style={styles.stopControl}
                  >
                    <MaterialIcons name="arrow-downward" size={18} color={isDark ? "#aaa" : "#666"} />
                  </Pressable>
                )}
                <Pressable
                  onPress={() => removeStop(i)}
                  hitSlop={6}
                  style={styles.stopControl}
                >
                  <MaterialIcons name="close" size={18} color="#e74c3c" />
                </Pressable>
              </View>
            ))}
          </ScrollView>

          {/* Add Stop button */}
          <Pressable
            style={({ pressed }) => [
              styles.addStopButton,
              {
                backgroundColor: isDark ? "#333" : "#f0f0f0",
                opacity: pressed ? 0.7 : 1,
              },
            ]}
            onPress={() => {
              setAddingStop(true);
              setSearchText("");
              searchInputRef.current?.focus();
            }}
          >
            <MaterialIcons name="add" size={20} color={isDark ? "#aaa" : "#555"} />
            <Text style={[styles.addStopText, { color: isDark ? "#ccc" : "#444" }]}>
              Add Stop
            </Text>
          </Pressable>

          {/* Start Route button */}
          {routeSteps.length > 0 && (
            <Pressable
              style={({ pressed }) => [
                styles.startRouteButton,
                { opacity: pressed ? 0.7 : 1 },
              ]}
              onPress={() => {
                setIsNavigating(true);
                setCurrentStepIndex(0);
                setFollowUser(false);
                const firstLoc = routeSteps[0]?.maneuver.location;
                if (firstLoc) {
                  cameraRef.current?.flyTo({
                    center: firstLoc,
                    zoom: 17,
                    duration: 1000,
                  });
                }
              }}
            >
              <MaterialIcons name="navigation" size={20} color="#fff" style={{ marginRight: 6 }} />
              <Text style={styles.startRouteButtonText}>Start Route</Text>
            </Pressable>
          )}

          {/* Cancel Trip button */}
          <Pressable
            style={({ pressed }) => [
              styles.cancelTripButton,
              { opacity: pressed ? 0.7 : 1 },
            ]}
            onPress={() => {
              setStops([]);
              setSelectedPlace(null);
              setSearchText("");
              setSuggestions([]);
              setPreviewPins([]);
              setAddingStop(false);
              clearRoute();
              setFollowUser(true);
            }}
          >
            <MaterialIcons name="close" size={18} color="#e74c3c" />
            <Text style={styles.cancelTripText}>Cancel Trip</Text>
          </Pressable>
        </View>
      )}

      {/* Navigation bottom sheet */}
      {isNavigating && routeSteps.length > 0 && (
        <View
          onLayout={(e) => { bottomSheetHeight.current = e.nativeEvent.layout.height; }}
          style={[
            styles.bottomSheet,
            { backgroundColor: isDark ? "#222" : "#fff", borderColor: isDark ? "#444" : "#ccc" },
          ]}
        >
          {/* Current step card */}
          <View style={[styles.navCurrentStep, { backgroundColor: isDark ? "#2a3a2a" : "#e8f5e9" }]}>
            <MaterialIcons
              name={getManeuverIcon(routeSteps[currentStepIndex].maneuver)}
              size={36}
              color={isDark ? "#6ddb6d" : "#2e7d32"}
              style={{ marginRight: 12 }}
            />
            <View style={{ flex: 1 }}>
              <Text style={[styles.navCurrentText, { color: isDark ? "#eee" : "#111" }]}>
                {getStepInstruction(routeSteps[currentStepIndex])}
              </Text>
              <Text style={[styles.navCurrentDistance, { color: isDark ? "#aaa" : "#666" }]}>
                {formatDistance(routeSteps[currentStepIndex].distance)}
              </Text>
            </View>
          </View>

          {/* Step counter */}
          <Text style={[styles.navStepCounter, { color: isDark ? "#999" : "#888" }]}>
            Step {currentStepIndex + 1} of {routeSteps.length}
          </Text>

          {/* Upcoming steps */}
          <ScrollView style={styles.navUpcomingScroll}>
            {routeSteps.slice(currentStepIndex + 1).map((step, i) => {
              const actualIndex = currentStepIndex + 1 + i;
              return (
                <Pressable
                  key={actualIndex}
                  style={({ pressed }) => [
                    styles.navUpcomingRow,
                    { borderBottomColor: isDark ? "#444" : "#eee", opacity: pressed ? 0.6 : 1 },
                  ]}
                  onPress={() => {
                    setCurrentStepIndex(actualIndex);
                    cameraRef.current?.flyTo({
                      center: routeSteps[actualIndex].maneuver.location,
                      zoom: 17,
                      duration: 1000,
                    });
                  }}
                >
                  <MaterialIcons
                    name={getManeuverIcon(step.maneuver)}
                    size={20}
                    color={isDark ? "#aaa" : "#666"}
                    style={{ marginRight: 10 }}
                  />
                  <Text
                    style={[styles.navUpcomingText, { color: isDark ? "#ccc" : "#333" }]}
                    numberOfLines={1}
                  >
                    {getStepInstruction(step)}
                  </Text>
                  <Text style={[styles.navUpcomingDist, { color: isDark ? "#888" : "#999" }]}>
                    {formatDistance(step.distance)}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>

          {/* Prev / Next buttons */}
          <View style={styles.navButtonRow}>
            <Pressable
              style={({ pressed }) => [
                styles.navButton,
                {
                  backgroundColor: isDark ? "#333" : "#f0f0f0",
                  opacity: pressed || currentStepIndex === 0 ? 0.5 : 1,
                },
              ]}
              disabled={currentStepIndex === 0}
              onPress={() => {
                const prev = currentStepIndex - 1;
                setCurrentStepIndex(prev);
                cameraRef.current?.flyTo({
                  center: routeSteps[prev].maneuver.location,
                  zoom: 17,
                  duration: 800,
                });
              }}
            >
              <MaterialIcons name="chevron-left" size={22} color={isDark ? "#ccc" : "#333"} />
              <Text style={[styles.navButtonText, { color: isDark ? "#ccc" : "#333" }]}>Prev</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [
                styles.navButton,
                {
                  backgroundColor: isDark ? "#333" : "#f0f0f0",
                  opacity: pressed || currentStepIndex >= routeSteps.length - 1 ? 0.5 : 1,
                },
              ]}
              disabled={currentStepIndex >= routeSteps.length - 1}
              onPress={() => {
                const next = currentStepIndex + 1;
                setCurrentStepIndex(next);
                cameraRef.current?.flyTo({
                  center: routeSteps[next].maneuver.location,
                  zoom: 17,
                  duration: 800,
                });
              }}
            >
              <Text style={[styles.navButtonText, { color: isDark ? "#ccc" : "#333" }]}>Next</Text>
              <MaterialIcons name="chevron-right" size={22} color={isDark ? "#ccc" : "#333"} />
            </Pressable>
          </View>

          {/* End Navigation */}
          <Pressable
            style={({ pressed }) => [
              styles.endNavButton,
              { opacity: pressed ? 0.7 : 1 },
            ]}
            onPress={() => {
              setIsNavigating(false);
              setCurrentStepIndex(0);
              setFollowUser(true);
              // Fit camera to full route
              if (routeGeoJSON) {
                const coords = routeGeoJSON.coordinates as [number, number][];
                let minLon = Infinity, maxLon = -Infinity, minLat = Infinity, maxLat = -Infinity;
                for (const [lon, lat] of coords) {
                  if (lon < minLon) minLon = lon;
                  if (lon > maxLon) maxLon = lon;
                  if (lat < minLat) minLat = lat;
                  if (lat > maxLat) maxLat = lat;
                }
                const pad = bottomSheetHeight.current + 40;
                cameraRef.current?.fitBounds(
                  [minLon, minLat, maxLon, maxLat],
                  { padding: { top: 80, right: 40, bottom: pad, left: 40 }, duration: 1500 }
                );
              }
            }}
          >
            <MaterialIcons name="close" size={18} color="#e74c3c" />
            <Text style={styles.endNavButtonText}>End Navigation</Text>
          </Pressable>
        </View>
      )}

      {/* Recenter button — visible when off-center or zoomed away from default */}
      {locationGranted && (!followUser || Math.abs(currentZoom - DEFAULT_ZOOM) > 0.5) && (
        <Pressable
          style={styles.recenterButton}
          onPress={() => {
            if (followUser) {
              // Already following — tap resets zoom to default
              Location.getLastKnownPositionAsync().then((pos) => {
                if (pos) {
                  cameraRef.current?.flyTo({
                    center: [pos.coords.longitude, pos.coords.latitude],
                    zoom: DEFAULT_ZOOM,
                    duration: 1000,
                  });
                }
              });
              return;
            }

            const now = Date.now();
            const doubleTap = now - lastRecenterRef.current < 400;
            lastRecenterRef.current = now;

            if (doubleTap) {
              // Double-tap: recenter + reset zoom
              Location.getLastKnownPositionAsync().then((pos) => {
                if (pos) {
                  cameraRef.current?.flyTo({
                    center: [pos.coords.longitude, pos.coords.latitude],
                    zoom: DEFAULT_ZOOM,
                    duration: 1000,
                  });
                }
              });
              setFollowUser(true);
            } else {
              // Single tap: recenter only, keep current zoom
              setFollowUser(true);
            }
          }}
        >
          <MaterialIcons name="my-location" size={22} color="#000" />
        </Pressable>
      )}

      {!locationGranted && (
        <View style={styles.loading}>
          <ActivityIndicator size="large" />
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
  loading: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: "center",
    alignItems: "center",
  },
  searchBar: {
    position: "absolute",
    top: 60,
    left: 12,
    right: 12,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 10,
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    paddingVertical: 0,
  },
  suggestionsContainer: {
    position: "absolute",
    top: 100,
    left: 12,
    right: 12,
    maxHeight: 220,
    borderRadius: 10,
    borderWidth: 1,
    overflow: "hidden",
    elevation: 5,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 4,
  },
  suggestionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  suggestionText: {
    fontSize: 14,
  },
  suggestionSubtext: {
    fontSize: 12,
    marginTop: 2,
  },
  pin: {
    alignItems: "center",
    justifyContent: "center",
  },
  bottomSheet: {
    position: "absolute",
    bottom: 24,
    left: 12,
    right: 12,
    borderRadius: 14,
    borderWidth: 1,
    padding: 16,
    elevation: 6,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  bottomSheetName: {
    fontSize: 17,
    fontWeight: "700",
  },
  categoryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    marginTop: 8,
    gap: 6,
  },
  categoryTag: {
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  categoryText: {
    fontSize: 12,
  },
  bottomSheetAddress: {
    fontSize: 13,
    marginTop: 8,
  },
  bottomSheetCity: {
    fontSize: 12,
    marginTop: 4,
  },
  directionsButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 12,
    paddingVertical: 10,
    borderRadius: 10,
  },
  directionsButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  modeRow: {
    flexDirection: "row",
    gap: 10,
  },
  modeButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 10,
  },
  routeInfo: {
    fontSize: 14,
    fontWeight: "500",
    textAlign: "center",
    marginTop: 8,
  },
  recenterButton: {
    position: "absolute",
    top: 170,
    right:12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#fff",
    borderWidth: 2,
    borderColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  stopMarker: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "#e74c3c",
    alignItems: "center",
    justifyContent: "center",
  },
  stopMarkerText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 13,
  },
  stopsScroll: {
    maxHeight: 150,
    marginTop: 8,
  },
  stopRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  stopMarkerSmall: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#e74c3c",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  stopMarkerSmallText: {
    color: "#fff",
    fontWeight: "700",
    fontSize: 11,
  },
  stopName: {
    flex: 1,
    fontSize: 14,
  },
  stopControl: {
    padding: 4,
    marginLeft: 2,
  },
  addStopButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    paddingVertical: 8,
    borderRadius: 10,
    gap: 4,
  },
  addStopText: {
    fontSize: 14,
    fontWeight: "600",
  },
  cancelTripButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    paddingVertical: 6,
    gap: 4,
  },
  cancelTripText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#e74c3c",
  },
  startRouteButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 10,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: "#34A853",
  },
  startRouteButtonText: {
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  navCurrentStep: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    borderRadius: 10,
  },
  navCurrentText: {
    fontSize: 16,
    fontWeight: "600",
  },
  navCurrentDistance: {
    fontSize: 13,
    marginTop: 4,
  },
  navStepCounter: {
    fontSize: 12,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 4,
  },
  navUpcomingScroll: {
    maxHeight: 130,
    marginTop: 4,
  },
  navUpcomingRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  navUpcomingText: {
    flex: 1,
    fontSize: 13,
  },
  navUpcomingDist: {
    fontSize: 12,
    marginLeft: 8,
  },
  navButtonRow: {
    flexDirection: "row",
    gap: 10,
    marginTop: 10,
  },
  navButton: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
    borderRadius: 10,
    gap: 2,
  },
  navButtonText: {
    fontSize: 14,
    fontWeight: "600",
  },
  endNavButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
    paddingVertical: 6,
    gap: 4,
  },
  endNavButtonText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#e74c3c",
  },
});
