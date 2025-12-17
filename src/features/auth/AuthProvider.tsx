import { ReactNode } from "react";
import { useAuth } from "../../store/useAuth";
import { Box, Button, Typography } from "@mui/material";
import config from "../../config.json";

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  if (config.target === "public") {
    return children;
  }

  const { isAuthenticated, isAuthorized, isLoading, login, logout, user, hasError } = useAuth();

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

  if (!isAuthorized) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          height: "100vh",
          gap: 2,
          p: 3,
          textAlign: "center",
        }}>
        <Typography variant="h5">Access Denied</Typography>
        <Typography>Your account ({user}) is not authorized to access this application.</Typography>
        <Typography variant="body2" color="text.secondary">
          Please contact FinnGen service desk if you believe this is an error.
        </Typography>
        <Button variant="outlined" onClick={logout} sx={{ mt: 2 }}>
          Sign out
        </Button>
      </Box>
    );
  }

  return children;
}
