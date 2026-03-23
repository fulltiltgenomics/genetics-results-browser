import { useState } from "react";
import { Typography, Box, Link, useMediaQuery, IconButton, Button, Menu, MenuItem } from "@mui/material";
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import KeyIcon from "@mui/icons-material/Key";
import LogoutIcon from "@mui/icons-material/Logout";
import { useHotkeys } from "react-hotkeys-hook";
import config from "../../config.json";
import broadLogo from "../../assets/broad-logo.png";
import finngenLogo from "../../assets/finngen-logo-400-1.png";
import { useThemeStore } from "@/store/store.theme";
import { useAuth } from "@/store/useAuth";
import { useLocation } from "react-router-dom";
import McpTokenDialog from "./McpTokenDialog";

const Header = () => {
  const location = useLocation();
  const sounds = [
    "https://sound.peal.io/ps/audios/000/029/713/original/youtube_29713.mp3?1553760622",
    "https://sound.peal.io/ps/audios/000/029/696/original/youtube_29696.mp3?1553758748",
    "https://sound.peal.io/ps/audios/000/029/706/original/youtube_29706.mp3?1553759924",
    "https://sound.peal.io/ps/audios/000/029/716/original/youtube_29716.mp3?1553760827",
    "https://sound.peal.io/ps/audios/000/029/697/original/youtube_29697.mp3?1553758854",
    "https://sound.peal.io/ps/audios/000/029/712/original/youtube_29712.mp3?1553760486",
    "https://sound.peal.io/ps/audios/000/029/699/original/youtube_29699.mp3?1553759113",
    "https://sound.peal.io/ps/audios/000/029/714/original/youtube_29714.mp3?1553760710",
    "https://sound.peal.io/ps/audios/000/029/710/original/youtube_29710.mp3?1553760216",
    "https://sound.peal.io/ps/audios/000/029/697/original/youtube_29697.mp3?1553758854",
    "https://sound.peal.io/ps/audios/000/029/707/original/youtube_29707.mp3?1553759990",
  ];
  useHotkeys("ctrl+s", () => new Audio(sounds[Math.floor(Math.random() * sounds.length)]).play());

  const prefersDarkMode = useMediaQuery("(prefers-color-scheme: dark)");
  const { isDarkMode, setDarkMode: setTheme } = useThemeStore();
  const actualDarkMode = isDarkMode ?? prefersDarkMode;

  const { isAuthenticated, user, login, logout } = useAuth();
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);

  const handleThemeClick = () => {
    setTheme(!actualDarkMode);
  };

  return (
    <>
      <Box
        component="header"
        sx={{
          display: "flex",
          flexDirection: "row",
          width: "100%",
          alignItems: "center",
          gap: 2,
        }}>
        <IconButton onClick={handleThemeClick} color="inherit" aria-label="toggle theme">
          {actualDarkMode ? <Brightness7Icon /> : <Brightness4Icon />}
        </IconButton>
        {/* <Typography variant="h6">
          <Link href="/" underline="hover">
            Home
          </Link>
        </Typography>
        <Typography variant="h6" sx={{ paddingLeft: "20px" }}>
          <Link href="/about" underline="hover">
            About
          </Link>
        </Typography>
        <Typography variant="h6" sx={{ paddingLeft: "20px" }}>
          <Link href="/changelog" underline="hover">
            Changelog
          </Link>
        </Typography> */}
        <Box component="img" src={broadLogo} alt="Broad Institute" sx={{ height: 32, backgroundColor: "white", p: 0.5, borderRadius: 0.5 }} />
        <Box
          component="img"
          src={finngenLogo}
          alt="FinnGen"
          onDoubleClick={() => new Audio(sounds[Math.floor(Math.random() * sounds.length)]).play()}
          sx={{ height: 40, backgroundColor: "white", p: 0.5, borderRadius: 0.5 }}
        />
        <Box flexGrow={1} />
        {isAuthenticated ? (
          <>
            <Button
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              color="inherit"
              sx={{ textTransform: "none" }}
            >
              {user}
            </Button>
            <Menu
              anchorEl={menuAnchor}
              open={Boolean(menuAnchor)}
              onClose={() => setMenuAnchor(null)}
            >
              <MenuItem
                onClick={() => {
                  setMenuAnchor(null);
                  setTokenDialogOpen(true);
                }}
              >
                <KeyIcon fontSize="small" sx={{ mr: 1 }} />
                MCP and API keys
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenuAnchor(null);
                  logout();
                }}
              >
                <LogoutIcon fontSize="small" sx={{ mr: 1 }} />
                Logout
              </MenuItem>
            </Menu>
            <McpTokenDialog open={tokenDialogOpen} onClose={() => setTokenDialogOpen(false)} />
          </>
        ) : import.meta.env.VITE_TARGET === "public" ? null : (
          <Button onClick={() => login()}>Login</Button>
        )}
      </Box>
      {/* <Typography variant="h6" style={{ marginBottom: "20px" }}>
        {config.title}
      </Typography> */}
    </>
  );
};

export default Header;
