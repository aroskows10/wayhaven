import { StyleSheet, View } from "react-native";
import Mapbox from "@rnmapbox/maps";

Mapbox.setAccessToken("pk.eyJ1IjoiYXJvc2tvd3NraSIsImEiOiJjbWxidGdxaWMwbDBpM2RxMmE4cWZwemszIn0.-_B2ws8d6EHQmntsInt5FQ");

export default function Map() {
  return (
    <View style={styles.container}>
      <Mapbox.MapView style={styles.map}>
        <Mapbox.Camera
          zoomLevel={14}
          followUserLocation={true}
        />
        <Mapbox.UserLocation visible={true} />
      </Mapbox.MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
});
