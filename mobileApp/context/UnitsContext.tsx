import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

type UnitPreference = "mi" | "km";

interface UnitsContextValue {
  unitPreference: UnitPreference;
  setUnitPreference: (pref: UnitPreference) => void;
}

const STORAGE_KEY = "unit-preference";

const UnitsContext = createContext<UnitsContextValue | null>(null);

export function UnitsProvider({ children }: { children: ReactNode }) {
  const [unitPreference, setUnitPreferenceState] = useState<UnitPreference>("mi");

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((value) => {
      if (value === "mi" || value === "km") {
        setUnitPreferenceState(value);
      }
    });
  }, []);

  const setUnitPreference = (pref: UnitPreference) => {
    setUnitPreferenceState(pref);
    AsyncStorage.setItem(STORAGE_KEY, pref);
  };

  return (
    <UnitsContext.Provider value={{ unitPreference, setUnitPreference }}>
      {children}
    </UnitsContext.Provider>
  );
}

export function useUnits() {
  const ctx = useContext(UnitsContext);
  if (!ctx) throw new Error("useUnits must be used within a UnitsProvider");
  return ctx;
}
