import { StyleSheet, Text, View } from "react-native";



export default function Map() {
  return (
    <>
      <View style={styles.container}>
       
        <Text>This is the index page of MAP (default Home)r</Text>
      </View>
     
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#16a355ff",
    alignItems: "center",
    justifyContent: "center",
  },
});
