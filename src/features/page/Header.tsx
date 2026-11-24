import { useState } from "react";
import type { Theme } from "@mui/material/styles";
import { Box, ButtonBase, useMediaQuery, IconButton, Button, Menu, MenuItem } from "@mui/material";
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import AdminPanelSettingsIcon from "@mui/icons-material/AdminPanelSettings";
import AccountCircleIcon from "@mui/icons-material/AccountCircle";
import KeyIcon from "@mui/icons-material/Key";
import EditNoteIcon from "@mui/icons-material/EditNote";
import PsychologyIcon from "@mui/icons-material/Psychology";
import LogoutIcon from "@mui/icons-material/Logout";
import { useHotkeys } from "react-hotkeys-hook";
import broadLogo from "../../assets/broad-logo.png";
import finngenLogo from "../../assets/finngen-logo-400-1.png";
import { useThemeStore } from "@/store/store.theme";
import { useAuth } from "@/store/useAuth";
import { Link as RouterLink, useLocation, useNavigate } from "react-router";
import McpTokenDialog from "./McpTokenDialog";
import InstructionsDialog from "../chat/InstructionsDialog";
import MemoryDialog from "../chat/MemoryDialog";

// the LD lookup is a view of the annotation tool, and / opens the chat. the gene evidence page
// (/gene) is routed but not offered here
const NAV = [
  { label: "Chat", to: "/", isCurrent: (path: string) => path === "/" || under(path, "/chat") },
  {
    label: "Anno",
    to: "/anno",
    isCurrent: (path: string) => under(path, "/anno") || under(path, "/ld"),
  },
];

// the main shade of the primary colour is too dim on the dark background
const mark = (theme: Theme) =>
  theme.palette.primary[theme.palette.mode === "dark" ? "light" : "main"];

const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

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
  // on phones the full email + buttons overflow the row and overlap; collapse to icons
  const isNarrow = useMediaQuery("(max-width: 600px)");
  const { isDarkMode, setDarkMode: setTheme } = useThemeStore();
  const actualDarkMode = isDarkMode ?? prefersDarkMode;

  const navigate = useNavigate();
  const { isAuthenticated, isAdmin, user, login, logout } = useAuth();
  const [menuAnchor, setMenuAnchor] = useState<null | HTMLElement>(null);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [instructionsDialogOpen, setInstructionsDialogOpen] = useState(false);
  const [memoryDialogOpen, setMemoryDialogOpen] = useState(false);

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
          flexWrap: { xs: "wrap", sm: "nowrap" },
          gap: { xs: 1, sm: 2 },
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
        <Box
          component="nav"
          aria-label="main"
          sx={{
            display: "flex",
            alignSelf: "stretch",
            gap: 0.5,
            pl: { xs: 0, sm: 1 },
            // on a phone the links do not fit beside the logos, so they take the row below
            order: { xs: 1, sm: 0 },
            flexBasis: { xs: "100%", sm: "auto" },
          }}>
          {NAV.map((item) => {
            const current = item.isCurrent(location.pathname);
            return (
              // client-side routing, not href, so moving between pages does not reload the app
              <ButtonBase
                key={item.to}
                component={RouterLink}
                to={item.to}
                aria-current={current ? "page" : undefined}
                sx={(theme) => ({
                  px: 1.5,
                  minHeight: 40,
                  borderRadius: "4px 4px 0 0",
                  whiteSpace: "nowrap",
                  fontSize: "1rem",
                  fontWeight: 500,
                  color: current ? "text.primary" : "text.secondary",
                  // the mark of the current page is drawn inside the link, so it takes no room
                  // and the row does not shift between pages
                  boxShadow: current ? `inset 0 -2px 0 ${mark(theme)}` : "none",
                  transition: theme.transitions.create(["color", "background-color"], {
                    duration: theme.transitions.duration.shortest,
                  }),
                  "&:hover": { color: "text.primary", backgroundColor: "action.hover" },
                  "&.Mui-focusVisible": {
                    outline: `2px solid ${mark(theme)}`,
                    outlineOffset: -2,
                  },
                })}>
                {item.label}
              </ButtonBase>
            );
          })}
        </Box>
        <Box flexGrow={1} />
        {isAdmin &&
          (isNarrow ? (
            <IconButton onClick={() => navigate("/admin")} color="inherit" aria-label="Admin">
              <AdminPanelSettingsIcon />
            </IconButton>
          ) : (
            <Button
              onClick={() => navigate("/admin")}
              color="inherit"
              startIcon={<AdminPanelSettingsIcon />}
              sx={{ textTransform: "none" }}
            >
              Admin
            </Button>
          ))}
        {isAuthenticated ? (
          <>
            {isNarrow ? (
              <IconButton
                onClick={(e) => setMenuAnchor(e.currentTarget)}
                color="inherit"
                aria-label={user ?? "account"}
              >
                <AccountCircleIcon />
              </IconButton>
            ) : (
              <Button
                onClick={(e) => setMenuAnchor(e.currentTarget)}
                color="inherit"
                sx={{ textTransform: "none" }}
              >
                {user}
              </Button>
            )}
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
                  setInstructionsDialogOpen(true);
                }}
              >
                <EditNoteIcon fontSize="small" sx={{ mr: 1 }} />
                Instructions
              </MenuItem>
              <MenuItem
                onClick={() => {
                  setMenuAnchor(null);
                  setMemoryDialogOpen(true);
                }}
              >
                <PsychologyIcon fontSize="small" sx={{ mr: 1 }} />
                Memory
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
            <InstructionsDialog
              open={instructionsDialogOpen}
              onClose={() => setInstructionsDialogOpen(false)}
            />
            <MemoryDialog
              open={memoryDialogOpen}
              onClose={() => setMemoryDialogOpen(false)}
              projectId={null}
            />
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
