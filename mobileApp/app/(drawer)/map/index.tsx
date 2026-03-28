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
import Mapbox from "@rnmapbox/maps";
import * as Location from "expo-location";
import { useTheme } from "../../../context/ThemeContext";
import { useUnits } from "../../../context/UnitsContext";

const ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN!;

Mapbox.setAccessToken(ACCESS_TOKEN);

interface Suggestion {
  mapbox_id: string;
  name: string;
  full_address: string;
}

interface PreviewPin {
  mapbox_id: string;
  name: string;
  full_address: string;
  longitude: number;
  latitude: number;
  poi_category?: string[];
  brand?: string;
  address?: string;
  place_formatted?: string;
  city?: string;
}

interface SelectedPlace {
  name: string;
  longitude: number;
  latitude: number;
  poi_category?: string[];
  brand?: string;
  address?: string;
  place_formatted?: string;
  city?: string;
}

export default function Map() {
  const { colorScheme } = useTheme();
  const { unitPreference } = useUnits();
  const isDark = colorScheme === "dark";

  const [locationGranted, setLocationGranted] = useState(false);
  const [followUser, setFollowUser] = useState(true);

  const [searchText, setSearchText] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<SelectedPlace | null>(null);
  const [previewPins, setPreviewPins] = useState<PreviewPin[]>([]);

  type RouteProfile = "driving" | "walking" | "cycling";
  const [routeGeoJSON, setRouteGeoJSON] = useState<GeoJSON.LineString | null>(null);
  const [routeProfile, setRouteProfile] = useState<RouteProfile>("driving");
  const [routeDuration, setRouteDuration] = useState<number | null>(null);
  const [routeDistance, setRouteDistance] = useState<number | null>(null);
  const [retrievingPlace, setRetrievingPlace] = useState(false);
  const [loadingRoute, setLoadingRoute] = useState(false);

  const [stops, setStops] = useState<SelectedPlace[]>([]);
  const [addingStop, setAddingStop] = useState(false);

  const searchInputRef = useRef<TextInput>(null);
  const bottomSheetHeight = useRef(300); // measured dynamically via onLayout

  // Refs so onCameraChanged always sees current values
  const searchTextRef = useRef(searchText);
  searchTextRef.current = searchText;
  const selectedPlaceRef = useRef<SelectedPlace | null>(selectedPlace);
  selectedPlaceRef.current = selectedPlace;
  const stopsRef = useRef(stops);
  stopsRef.current = stops;
  // Flag: true when geocode was triggered by camera pan (skip auto-zoom & dropdown)
  const isResearchRef = useRef(false);

  const sessionTokenRef = useRef(
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    })
  );

  const cameraRef = useRef<Mapbox.Camera>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapStateRef = useRef<{
    lon: number;
    lat: number;
    bounds: { ne: [number, number]; sw: [number, number] } | null;
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

  // Debounced search using Mapbox Search Box API
  const geocode = useCallback((query: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (query.length < 2) {
      setSuggestions([]);
      setPreviewPins([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const coords = mapStateRef.current;
        const proximity = coords
          ? `&proximity=${coords.lon},${coords.lat}`
          : "";
        const url = `https://api.mapbox.com/search/searchbox/v1/suggest?q=${encodeURIComponent(
          query
        )}&limit=10&types=poi,address,place${proximity}&session_token=${sessionTokenRef.current}&access_token=${ACCESS_TOKEN}`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.suggestions) {
          const rawSuggestions: Suggestion[] = data.suggestions.map(
            (s: any) => ({
              mapbox_id: s.mapbox_id,
              name: s.name,
              full_address: s.full_address || s.place_formatted || s.name,
            })
          );
          if (!isResearchRef.current) setSuggestions(rawSuggestions);

          // Batch-retrieve coordinates for all suggestions in parallel
          const pinResults = await Promise.all(
            rawSuggestions.map(async (s) => {
              try {
                const rUrl = `https://api.mapbox.com/search/searchbox/v1/retrieve/${s.mapbox_id}?session_token=${sessionTokenRef.current}&access_token=${ACCESS_TOKEN}`;
                const rRes = await fetch(rUrl);
                const rData = await rRes.json();
                const feature = rData.features?.[0];
                if (feature) {
                  const [lon, lat] = feature.geometry.coordinates;
                  const props = feature.properties ?? {};
                  return {
                    mapbox_id: s.mapbox_id,
                    name: s.name,
                    full_address: s.full_address,
                    longitude: lon,
                    latitude: lat,
                    poi_category: props.poi_category,
                    brand: props.brand,
                    address: props.address,
                    place_formatted: props.place_formatted,
                    city: props.context?.place?.name,
                  } as PreviewPin;
                }
              } catch {
                // skip failed retrieves
              }
              return null;
            })
          );

          const pins = pinResults.filter(Boolean) as PreviewPin[];
          setPreviewPins(pins);
          if (!isResearchRef.current) setSelectedPlace(null);

          // Auto-zoom: if #1 result is outside current map bounds, fit to include it
          if (!isResearchRef.current && pins.length > 0 && mapStateRef.current?.bounds) {
            const best = pins[0];
            const { ne, sw } = mapStateRef.current.bounds;
            const inBounds =
              best.longitude >= sw[0] &&
              best.longitude <= ne[0] &&
              best.latitude >= sw[1] &&
              best.latitude <= ne[1];

            if (!inBounds) {
              const center = mapStateRef.current;
              cameraRef.current?.fitBounds(
                [
                  Math.max(center.lon, best.longitude) + 0.01,
                  Math.max(center.lat, best.latitude) + 0.01,
                ],
                [
                  Math.min(center.lon, best.longitude) - 0.01,
                  Math.min(center.lat, best.latitude) - 0.01,
                ],
                80,
                1500
              );
            }
          }
          isResearchRef.current = false;
        }
      } catch {
        // silently ignore network errors
      }
    }, 300);
  }, []);

  const onChangeSearch = (text: string) => {
    isResearchRef.current = false;
    setSearchText(text);
    if (text.length === 0) {
      setSuggestions([]);
      setSelectedPlace(null);
      setPreviewPins([]);
    } else {
      geocode(text);
    }
  };

  const onSelectSuggestion = async (suggestion: Suggestion) => {
    setSuggestions([]);
    Keyboard.dismiss();

    const resolvePlace = async (): Promise<SelectedPlace | null> => {
      const pin = previewPins.find((p) => p.mapbox_id === suggestion.mapbox_id);
      if (pin) {
        return {
          name: pin.name,
          longitude: pin.longitude,
          latitude: pin.latitude,
          poi_category: pin.poi_category,
          brand: pin.brand,
          address: pin.address,
          place_formatted: pin.place_formatted,
          city: pin.city,
        };
      }
      setRetrievingPlace(true);
      try {
        const url = `https://api.mapbox.com/search/searchbox/v1/retrieve/${suggestion.mapbox_id}?session_token=${sessionTokenRef.current}&access_token=${ACCESS_TOKEN}`;
        const res = await fetch(url);
        const data = await res.json();
        const feature = data.features?.[0];
        if (feature) {
          const [lon, lat] = feature.geometry.coordinates;
          const props = feature.properties ?? {};
          return {
            name: suggestion.name,
            longitude: lon,
            latitude: lat,
            poi_category: props.poi_category,
            brand: props.brand,
            address: props.address,
            place_formatted: props.place_formatted,
            city: props.context?.place?.name,
          };
        }
      } catch {
        // silently ignore
      } finally {
        setRetrievingPlace(false);
      }
      return null;
    };

    const place = await resolvePlace();
    if (!place) return;

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
    cameraRef.current?.setCamera({
      centerCoordinate: [place.longitude, place.latitude],
      zoomLevel: 14,
      animationDuration: 1500,
      animationMode: "flyTo",
    });
  };

  const clearRoute = () => {
    setRouteGeoJSON(null);
    setRouteDuration(null);
    setRouteDistance(null);
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

      const url = `https://api.mapbox.com/directions/v5/mapbox/${profile}/${waypoints}?geometries=geojson&overview=full&access_token=${ACCESS_TOKEN}`;
      const res = await fetch(url);
      const data = await res.json();
      const route = data.routes?.[0];
      if (!route) return;

      setRouteGeoJSON(route.geometry);
      setRouteDuration(route.duration);
      setRouteDistance(route.distance);

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
        [maxLon, maxLat],
        [minLon, minLat],
        [80, 40, pad, 40], // top, right, bottom, left
        1500
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
    // If in route mode, just cancel the search and re-fit camera to route
    if (addingStop || stops.length > 0) {
      setSearchText("");
      setSuggestions([]);
      setPreviewPins([]);
      setAddingStop(false);
      // Re-fit camera to the existing route
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
          [maxLon, maxLat],
          [minLon, minLat],
          [80, 40, pad, 40],
          1500
        );
      }
      return;
    }
    setSearchText("");
    setSuggestions([]);
    setSelectedPlace(null);
    setPreviewPins([]);
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

  const addStopFromPin = (pin: PreviewPin) => {
    const place: SelectedPlace = {
      name: pin.name,
      longitude: pin.longitude,
      latitude: pin.latitude,
      poi_category: pin.poi_category,
      brand: pin.brand,
      address: pin.address,
      place_formatted: pin.place_formatted,
      city: pin.city,
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
      <Mapbox.MapView
        style={styles.map}
        compassEnabled={true}
        compassPosition={{ top: 85, right: 10 }}
        scaleBarPosition={{ top: 5, left: 13 }}
        styleURL={
          isDark ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Street
        }
        onTouchStart={onMapTouch}
        onCameraChanged={(e) => {
          const [lon, lat] = e.properties.center;
          const bounds = e.properties.bounds;
          mapStateRef.current = {
            lon,
            lat,
            bounds: bounds
              ? { ne: [bounds.ne[0], bounds.ne[1]], sw: [bounds.sw[0], bounds.sw[1]] }
              : null,
            zoom: e.properties.zoom,
          };

          // Re-search when user pans with an active query (no selection)
          if (searchTextRef.current.length >= 2) {
            isResearchRef.current = true;
            geocode(searchTextRef.current);
          }
        }}
      >
        {locationGranted && (
          <>
            <Mapbox.Camera
              ref={cameraRef}
              followUserLocation={followUser}
              followZoomLevel={12}
            />
            <Mapbox.UserLocation visible={true} />
          </>
        )}

        {/* All preview pins — selected one turns red; in route mode, hide pins that are already stops */}
        {previewPins
          .filter(
            (pin) =>
              !stops.some(
                (s) => s.longitude === pin.longitude && s.latitude === pin.latitude
              )
          )
          .map((pin) => {
            const isSelected =
              selectedPlace &&
              pin.longitude === selectedPlace.longitude &&
              pin.latitude === selectedPlace.latitude;
            return (
              <Mapbox.PointAnnotation
                key={pin.mapbox_id}
                id={`preview-${pin.mapbox_id}`}
                coordinate={[pin.longitude, pin.latitude]}
                onSelected={() => {
                  if (stops.length > 0) {
                    addStopFromPin(pin);
                  } else {
                    setSelectedPlace({
                      name: pin.name,
                      longitude: pin.longitude,
                      latitude: pin.latitude,
                      poi_category: pin.poi_category,
                      brand: pin.brand,
                      address: pin.address,
                      place_formatted: pin.place_formatted,
                      city: pin.city,
                    });
                    clearRoute();
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
              </Mapbox.PointAnnotation>
            );
          })}

        {/* Fallback selected pin — only when not in preview pins */}
        {selectedPlace &&
          !previewPins.some(
            (p) =>
              p.longitude === selectedPlace.longitude &&
              p.latitude === selectedPlace.latitude
          ) && (
            <Mapbox.PointAnnotation
              id="search-pin"
              coordinate={[selectedPlace.longitude, selectedPlace.latitude]}
            >
              <View style={styles.pin}>
                <MaterialIcons name="place" size={36} color="#e74c3c" />
              </View>
            </Mapbox.PointAnnotation>
          )}

        {routeGeoJSON && (
          <Mapbox.ShapeSource
            id="routeSource"
            shape={{ type: "Feature", properties: {}, geometry: routeGeoJSON }}
          >
            <Mapbox.LineLayer
              id="routeLine"
              style={{
                lineColor: routeLineColor[routeProfile],
                lineWidth: 4,
                lineCap: "round",
                lineJoin: "round",
              }}
            />
          </Mapbox.ShapeSource>
        )}

        {/* Numbered stop markers */}
        {stops.map((stop, i) => (
          <Mapbox.MarkerView
            key={`stop-${i}-${stop.longitude}-${stop.latitude}`}
            coordinate={[stop.longitude, stop.latitude]}
            anchor={{ x: 0.5, y: 0.5 }}
          >
            <View style={styles.stopMarker}>
              <Text style={styles.stopMarkerText}>{i + 1}</Text>
            </View>
          </Mapbox.MarkerView>
        ))}
      </Mapbox.MapView>

      {/* Search bar */}
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
        {retrievingPlace && (
          <ActivityIndicator size="small" color={barPlaceholder} style={{ marginRight: 6 }} />
        )}
        {searchText.length > 0 && (
          <Pressable onPress={onClearSearch} hitSlop={8}>
            <MaterialIcons name="close" size={20} color={barPlaceholder} />
          </Pressable>
        )}
      </View>

      {/* Suggestions dropdown */}
      {suggestions.length > 0 && (
        <View
          style={[
            styles.suggestionsContainer,
            { backgroundColor: suggBg, borderColor: suggBorder },
          ]}
        >
          <FlatList
            data={suggestions}
            keyExtractor={(item) => item.mapbox_id}
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
            {selectedPlace.brand ?? selectedPlace.name}
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
      {stops.length > 0 && (
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
                  {stop.brand ?? stop.name}
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

      {/* Recenter button */}
      {locationGranted && !followUser && (
        <Pressable
          style={styles.recenterButton}
          onPress={() => setFollowUser(true)}
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
});
