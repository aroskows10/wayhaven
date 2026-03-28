import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  Pressable,
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

const ACCESS_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN!;

Mapbox.setAccessToken(ACCESS_TOKEN);

interface Suggestion {
  mapbox_id: string;
  name: string;
  full_address: string;
}

interface SelectedPlace {
  name: string;
  longitude: number;
  latitude: number;
}

export default function Map() {
  const { colorScheme } = useTheme();
  const isDark = colorScheme === "dark";

  const [locationGranted, setLocationGranted] = useState(false);
  const [followUser, setFollowUser] = useState(true);

  const [searchText, setSearchText] = useState("");
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<SelectedPlace | null>(null);

  const sessionTokenRef = useRef(
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
    })
  );

  const cameraRef = useRef<Mapbox.Camera>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mapCenterRef = useRef<{ lon: number; lat: number } | null>(null);

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
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const coords = mapCenterRef.current;
        const proximity = coords
          ? `&proximity=${coords.lon},${coords.lat}`
          : "";
        const url = `https://api.mapbox.com/search/searchbox/v1/suggest?q=${encodeURIComponent(
          query
        )}&limit=5&types=poi,address,place${proximity}&session_token=${sessionTokenRef.current}&access_token=${ACCESS_TOKEN}`;
        const res = await fetch(url);
        const data = await res.json();

        if (data.suggestions) {
          setSuggestions(
            data.suggestions.map((s: any) => ({
              mapbox_id: s.mapbox_id,
              name: s.name,
              full_address: s.full_address || s.place_formatted || s.name,
            }))
          );
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
      setSelectedPlace(null);
    } else {
      geocode(text);
    }
  };

  const onSelectSuggestion = async (suggestion: Suggestion) => {
    setSearchText(suggestion.full_address);
    setSuggestions([]);
    Keyboard.dismiss();

    try {
      const url = `https://api.mapbox.com/search/searchbox/v1/retrieve/${suggestion.mapbox_id}?session_token=${sessionTokenRef.current}&access_token=${ACCESS_TOKEN}`;
      const res = await fetch(url);
      const data = await res.json();

      const feature = data.features?.[0];
      if (feature) {
        const [lon, lat] = feature.geometry.coordinates;
        const place: SelectedPlace = {
          name: suggestion.full_address,
          longitude: lon,
          latitude: lat,
        };
        setSelectedPlace(place);
        setFollowUser(false);

        cameraRef.current?.setCamera({
          centerCoordinate: [lon, lat],
          zoomLevel: 14,
          animationDuration: 1500,
          animationMode: "flyTo",
        });
      }
    } catch {
      // silently ignore network errors
    }
  };

  const onClearSearch = () => {
    setSearchText("");
    setSuggestions([]);
    setSelectedPlace(null);
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
          mapCenterRef.current = { lon, lat };
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

        {selectedPlace && (
          <Mapbox.PointAnnotation
            id="search-pin"
            coordinate={[selectedPlace.longitude, selectedPlace.latitude]}
          >
            <View style={styles.pin}>
              <MaterialIcons name="place" size={36} color="#e74c3c" />
            </View>
          </Mapbox.PointAnnotation>
        )}
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
                style={[styles.suggestionRow, { borderBottomColor: suggBorder }]}
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
});
