import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../../../context/ThemeContext";

const options = ["system", "light", "dark"] as const;

export default function Settings() {
  const { colorScheme, themePreference, setThemePreference } = useTheme();
  const isDark = colorScheme === "dark";

  return (
    <SafeAreaView style={[styles.container, { backgroundColor: isDark ? "#111" : "#fff" }]}>
      <Text style={[styles.heading, { color: isDark ? "#fff" : "#000" }]}>Appearance</Text>

      <View style={styles.optionsRow}>
        {options.map((opt) => {
          const active = themePreference === opt;
          return (
            <Pressable
              key={opt}
              onPress={() => setThemePreference(opt)}
              style={[
                styles.option,
                {
                  backgroundColor: active
                    ? isDark ? "#2a4a2a" : "#daf1d5"
                    : isDark ? "#222" : "#f0f0f0",
                  borderColor: active
                    ? isDark ? "#4a8a4a" : "#7bc47f"
                    : isDark ? "#333" : "#ddd",
                },
              ]}
            >
              <Text
                style={[
                  styles.optionLabel,
                  { color: isDark ? "#fff" : "#000", fontWeight: active ? "700" : "400" },
                ]}
              >
                {opt.charAt(0).toUpperCase() + opt.slice(1)}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
  },
  heading: {
    fontSize: 20,
    fontWeight: "600",
    marginBottom: 16,
  },
  optionsRow: {
    flexDirection: "row",
    gap: 12,
  },
  option: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 2,
    alignItems: "center",
  },
  optionLabel: {
    fontSize: 15,
  },
});
