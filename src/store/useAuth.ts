import { useEffect, useState } from "react";
import api from "./api";

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

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [hasError, setHasError] = useState<boolean>(false);
  const [user, setUser] = useState<string | null>(null);

  const login = () => {
    const currentUrl = window.location.href;
    window.location.href = `${api.defaults.baseURL}/v1/login?frontend_url=${encodeURIComponent(
      currentUrl
    )}`;
  };

  const logout = () => {
    api
      .get("/v1/logout")
      .then(() => {
        setIsAuthenticated(false);
        setUser(null);
      })
      .catch((error) => {
        console.error("Logout failed:", error);
        setIsAuthenticated(false);
        setUser(null);
      });
  };

  useEffect(() => {
    let isMounted = true;
    let retryTimeout: NodeJS.Timeout | undefined = undefined;

    const checkAuth = async () => {
      try {
        const response = await api.get<AuthResponse>("/v1/auth");
        if (isMounted) {
          setIsAuthenticated(response.data.session.user_email !== undefined);
          setUser(response.data.session.user_email ?? null);
          setIsLoading(false);
          setHasError(false);
        }
      } catch (error) {
        console.error(error);
        if (isMounted) {
          setIsAuthenticated(false);
          setIsLoading(false);
          setHasError(true);
          // retryTimeout = setTimeout(checkAuth, 5000);
        }
      }
    };

    checkAuth();

    return () => {
      isMounted = false;
      if (retryTimeout) clearTimeout(retryTimeout);
    };
  }, []);

  return {
    isAuthenticated: isAuthenticated ?? false,
    isLoading: isLoading || isAuthenticated === null,
    user,
    login,
    logout,
    hasError,
  };
}
