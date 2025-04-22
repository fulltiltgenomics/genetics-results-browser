import { ReactNode, useEffect } from "react";
import { useAuth } from "../../store/useAuth";
import api from "../../store/api";

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { isAuthenticated, isLoading, hasError } = useAuth();

  useEffect(() => {
    // only redirect if we've confirmed the user is not authenticated
    if (!isLoading && !isAuthenticated && hasError) {
      const currentUrl = window.location.href;
      window.location.href = `${api.defaults.baseURL}/login?frontend_url=${encodeURIComponent(
        currentUrl
      )}`;
    }
  }, [isAuthenticated, isLoading, hasError]);

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (hasError) {
    return <div>Authentication service unavailable</div>;
  }

  if (!isAuthenticated && !isLoading) {
    return null;
  }

  return <>{children}</>;
}
