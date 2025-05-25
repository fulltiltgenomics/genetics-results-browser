import { ReactNode } from "react";
import { useAuth } from "../../store/useAuth";
import { Typography } from "@mui/material";

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const { isAuthenticated, isLoading, login, hasError } = useAuth();

  if (isLoading) {
    return <Typography>Loading authentication...</Typography>;
  }

  if (hasError) {
    return <Typography>Error loading authentication</Typography>;
  }

  if (!isAuthenticated) {
    login();
  } else {
    return children;
  }

  return <Typography>Not authenticated</Typography>;
}
