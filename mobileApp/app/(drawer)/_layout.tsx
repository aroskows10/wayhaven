import { Drawer } from 'expo-router/drawer';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useTheme } from '../../context/ThemeContext';

export default function Layout() {
  const { colorScheme } = useTheme();
  const isDark = colorScheme === 'dark';

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Drawer sceneContainerStyle={{ backgroundColor: isDark ? "#111" : "#fff" }} screenOptions={{
          headerShown: false,
          drawerActiveBackgroundColor: isDark ? "#2a4a2a" : "#daf1d5ff",
          drawerActiveTintColor: isDark ? "#fff" : "#000",
          drawerInactiveTintColor: isDark ? "#ccc" : "#333",
          drawerItemStyle: {
            borderRadius: 0,
            marginHorizontal: 0,
            paddingHorizontal: 0,
          },
          drawerContentContainerStyle: {
            paddingHorizontal: 0,
            marginHorizontal: 0,
          },
          drawerStyle: {
            backgroundColor: isDark ? "#111" : "#fff",
          },
        }}>
        <Drawer.Screen name="map" 
          options={{ 
            drawerLabel: "Haven", 
            title: "Haven"
            }} 
          />
        <Drawer.Screen name="settings" 
            options = {{
              drawerLabel: "Settings",
              title: "Settings"
            }}
          />
        
      </Drawer>
    </GestureHandlerRootView>
  );
}
