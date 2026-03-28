import { Pressable, StyleSheet, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "../../../context/ThemeContext";
import { useUnits } from "../../../context/UnitsContext";

const options = ["system", "light", "dark"] as const;
const unitOptions = ["mi", "km"] as const;
const unitLabels: Record<string, string> = { mi: "Miles", km: "Kilometers" };

export default function Settings() {
  const { colorScheme, themePreference, setThemePreference } = useTheme();
  const { unitPreference, setUnitPreference } = useUnits();
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

      <Text style={[styles.heading, { color: isDark ? "#fff" : "#000", marginTop: 32 }]}>Units</Text>

      <View style={styles.optionsRow}>
        {unitOptions.map((opt) => {
          const active = unitPreference === opt;
          return (
            <Pressable
              key={opt}
              onPress={() => setUnitPreference(opt)}
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
                {unitLabels[opt]}
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
