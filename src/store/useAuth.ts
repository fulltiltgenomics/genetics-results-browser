import { useEffect, useState } from "react";
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
  email: string;
}

export function useAuth() {
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null);
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
        setIsAuthorized(null);
        setUser(null);
      })
      .catch((error) => {
        console.error("Logout failed:", error);
        setIsAuthenticated(false);
        setIsAuthorized(null);
        setUser(null);
      });
  };

  useEffect(() => {
    let isMounted = true;

    const checkAuth = async () => {
      try {
        const response = await api.get<AuthResponse>("/v1/auth");
        const isAuth = response.data.session.user_email !== undefined;

        if (isMounted) {
          setIsAuthenticated(isAuth);
          setUser(response.data.session.user_email ?? null);
          setHasError(false);

          if (isAuth) {
            // check authorization via /v1/me
            try {
              const meResponse = await api.get<MeResponse>("/v1/me");
              if (isMounted) {
                setIsAuthorized(true);
                setUser(meResponse.data.email);
                setIsLoading(false);
              }
            } catch (meError) {
              console.error("Authorization check failed:", meError);
              if (isMounted) {
                if (axios.isAxiosError(meError) && meError.response?.status === 403) {
                  // authenticated but not authorized (email not allowed)
                  setIsAuthorized(false);
                } else {
                  // other error - treat as server error
                  console.error("Unexpected error during authorization check:", meError);
                  setHasError(true);
                }
                setIsLoading(false);
              }
            }
          } else {
            setIsLoading(false);
          }
        }
      } catch (error) {
        console.error(error);
        if (isMounted) {
          setIsAuthenticated(false);
          setIsLoading(false);
          setHasError(true);
        }
      }
    };

    checkAuth();

    return () => {
      isMounted = false;
    };
  }, []);

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
