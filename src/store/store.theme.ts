import { create } from "zustand";
import { persist } from "zustand/middleware";

interface ThemeState {
  isDarkMode: boolean | null; // null means "use system preference"
  toggleDarkMode: () => void;
  setDarkMode: (isDark: boolean | null) => void;
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set) => ({
      isDarkMode: null,
      toggleDarkMode: () =>
        set((state) => ({
          isDarkMode: state.isDarkMode === null ? true : !state.isDarkMode,
        })),
      setDarkMode: (isDark: boolean | null) => set({ isDarkMode: isDark }),
    }),
    {
      name: "theme-storage",
    }
  )
);
