import { ReactNode } from "react";
import { useAuth } from "../../store/useAuth";
import { Typography } from "@mui/material";
import config from "../../config.json";

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  if (config.target === "public") {
    return children;
  }

  const { isAuthenticated, isLoading, login, hasError } = useAuth();

  if (isLoading) {
    return <Typography>Loading authentication...</Typography>;
  }

  if (hasError) {
    return <Typography>Not able to connect to server</Typography>;
  }

  if (!isAuthenticated) {
    login();
    return null;
  }

  return children;
}
