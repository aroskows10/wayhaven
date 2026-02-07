import { useEffect, useState } from "react";
import { ActivityIndicator, Pressable, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { MaterialIcons } from "@expo/vector-icons";
import Mapbox from "@rnmapbox/maps";
import * as Location from "expo-location";
import { useTheme } from "../../../context/ThemeContext";

Mapbox.setAccessToken("pk.eyJ1IjoiYXJvc2tvd3NraSIsImEiOiJjbWxidGdxaWMwbDBpM2RxMmE4cWZwemszIn0.-_B2ws8d6EHQmntsInt5FQ");

export default function Map() {
  const { colorScheme } = useTheme();
  const [locationGranted, setLocationGranted] = useState(false);
  const [followUser, setFollowUser] = useState(true);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === "granted") {
        setLocationGranted(true);
      }
    })();
  }, []);

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: colorScheme === "dark" ? "#111" : "#fff" }]}>
      <Mapbox.MapView
        style={styles.map}
        compassEnabled={true}
        compassPosition={{ top: 8, right: 8 }}
        styleURL={colorScheme === "dark" ? Mapbox.StyleURL.Dark : Mapbox.StyleURL.Street}
        onTouchStart={() => setFollowUser(false)}
      >
        {locationGranted && (
          <>
            <Mapbox.Camera
              followUserLocation={followUser}
              followZoomLevel={12}
            />
            <Mapbox.UserLocation visible={true} />
          </>
        )}
      </Mapbox.MapView>

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
  recenterButton: {
    position: "absolute",
    top: 100,
    right: 10,
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
