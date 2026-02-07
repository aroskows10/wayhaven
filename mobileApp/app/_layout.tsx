import { useEffect } from "react";
import { Slot } from "expo-router";
import { StatusBar } from "expo-status-bar";
import * as NavigationBar from "expo-navigation-bar";
import { ThemeProvider, useTheme } from "../context/ThemeContext";

function ThemedSystemBars() {
  const { colorScheme } = useTheme();
  const bg = colorScheme === "dark" ? "#111" : "#fff";

  useEffect(() => {
    NavigationBar.setBackgroundColorAsync(bg);
  }, [bg]);

  return (
    <StatusBar
      style={colorScheme === "dark" ? "light" : "dark"}
      backgroundColor={bg}
    />
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ThemedSystemBars />
      <Slot />
    </ThemeProvider>
  );
}
