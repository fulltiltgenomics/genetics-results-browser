import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import axios from "axios";

const chatUrl = import.meta.env.VITE_CHAT_URL;
const chatApi = axios.create({
  baseURL: chatUrl,
  headers: { "Content-Type": "application/json" },
  withCredentials: true,
});

interface AuthResponse {
  authenticated: boolean;
  user: string | null;
  is_admin: boolean;
}

interface MeResponse {
  user: string;
}

interface AuthState {
  isAuthenticated: boolean | null;
  isAuthorized: boolean | null;
  isAdmin: boolean;
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
  isAdmin: false,
  isLoading: true,
  hasError: false,
  user: null,

  login: () => {
    // auth is handled by IAP/oauth2-proxy — redirect to sign-in
    window.location.href = `/oauth2/sign_in?rd=${encodeURIComponent(window.location.pathname)}`;
  },

  logout: () => {
    window.location.href = `/oauth2/sign_out?rd=${encodeURIComponent(window.location.origin)}`;
  },

  checkAuth: async () => {
    if (get().isAuthenticated !== null) return;

    try {
      const response = await chatApi.get<AuthResponse>("/v1/auth");
      const isAuth = response.data.authenticated;
      const user = response.data.user;

      set({
        isAuthenticated: isAuth,
        isAdmin: response.data.is_admin ?? false,
        user: user ?? null,
        hasError: false,
      });

      if (isAuth) {
        try {
          const meResponse = await chatApi.get<MeResponse>("/v1/me");
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
  const { isAuthenticated, isAuthorized, isAdmin, isLoading, hasError, user, login, logout } = useAuthStore(
    useShallow((s) => ({
      isAuthenticated: s.isAuthenticated,
      isAuthorized: s.isAuthorized,
      isAdmin: s.isAdmin,
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
    isAdmin,
    isLoading: isLoading || isAuthenticated === null,
    user,
    login,
    logout,
    hasError,
  };
}
