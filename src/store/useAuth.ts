import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import api from "./api";
import axios from "axios";

interface AuthResponse {
  base_url: string;
  origin: string;
  referer: string;
  session: {
    frontend_url?: string;
    next?: string;
    user_email?: string;
  };
}

interface MeResponse {
  user: string;
  auth_enabled: boolean;
}

interface AuthState {
  isAuthenticated: boolean | null;
  isAuthorized: boolean | null;
  isLoading: boolean;
  hasError: boolean;
  user: string | null;
  login: () => void;
  logout: () => void;
  checkAuth: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  isAuthenticated: null,
  isAuthorized: null,
  isLoading: true,
  hasError: false,
  user: null,

  login: () => {
    const currentUrl = window.location.href;
    window.location.href = `${api.defaults.baseURL}/v1/login?frontend_url=${encodeURIComponent(
      currentUrl
    )}`;
  },

  logout: () => {
    api
      .get("/v1/logout")
      .then(() => {
        set({ isAuthenticated: false, isAuthorized: null, user: null });
      })
      .catch((error) => {
        console.error("Logout failed:", error);
        set({ isAuthenticated: false, isAuthorized: null, user: null });
      });
  },

  checkAuth: async () => {
    if (get().isAuthenticated !== null) return;

    try {
      const response = await api.get<AuthResponse>("/v1/auth");
      const userEmail = response.data.session.user_email;
      const isAuth = userEmail !== undefined;

      set({
        isAuthenticated: isAuth,
        user: userEmail ?? null,
        hasError: false,
      });

      if (isAuth) {
        try {
          const meResponse = await api.get<MeResponse>("/v1/me");
          set({
            isAuthorized: true,
            user: meResponse.data.user,
            isLoading: false,
          });
        } catch (meError) {
          console.error("Authorization check failed:", meError);
          if (axios.isAxiosError(meError) && meError.response?.status === 403) {
            set({ isAuthorized: false, isLoading: false });
          } else {
            console.error("Unexpected error during authorization check:", meError);
            set({ hasError: true, isLoading: false });
          }
        }
      } else {
        set({ isLoading: false });
      }
    } catch (error) {
      console.error(error);
      set({ isAuthenticated: false, isLoading: false, hasError: true });
    }
  },
}));

export function useAuth() {
  const { isAuthenticated, isAuthorized, isLoading, hasError, user, login, logout } = useAuthStore(
    useShallow((s) => ({
      isAuthenticated: s.isAuthenticated,
      isAuthorized: s.isAuthorized,
      isLoading: s.isLoading,
      hasError: s.hasError,
      user: s.user,
      login: s.login,
      logout: s.logout,
    }))
  );

  return {
    isAuthenticated: isAuthenticated ?? false,
    isAuthorized: isAuthorized ?? false,
    isLoading: isLoading || isAuthenticated === null,
    user,
    login,
    logout,
    hasError,
  };
}
