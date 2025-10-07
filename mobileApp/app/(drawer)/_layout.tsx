import { Drawer } from 'expo-router/drawer';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

export default function Layout() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <Drawer screenOptions={{
          headerShown: false,
          drawerActiveBackgroundColor: "#daf1d5ff",

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
