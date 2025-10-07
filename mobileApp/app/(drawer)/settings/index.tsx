import { StyleSheet, Text, View } from "react-native";


export default function Settings() {
  return (
    <>
      <View style={styles.container}>
       
        <Text>This is the index page of Settings (default Home)r</Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#ee3ab8ff",
    alignItems: "center",
    justifyContent: "center",
  },
});
