import { Typography, Box, Link, useMediaQuery, IconButton } from "@mui/material";
import Brightness4Icon from "@mui/icons-material/Brightness4";
import Brightness7Icon from "@mui/icons-material/Brightness7";
import SettingsBrightnessIcon from "@mui/icons-material/SettingsBrightness";
import { useHotkeys } from "react-hotkeys-hook";
import config from "../../config.json";
import { useThemeStore } from "@/store/store.theme";

const Header = () => {
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
          width: "fit-content",
          alignItems: "center",
          gap: 2,
        }}>
        <IconButton
          onClick={handleThemeClick}
          color="inherit"
          aria-label="toggle theme"
          style={{
            transform: "translateY(-5px)",
          }}>
          {actualDarkMode ? <Brightness7Icon /> : <Brightness4Icon />}
        </IconButton>
        <Typography variant="h6" sx={{ marginBottom: "10px" }}>
          <Link href="/" underline="hover">
            Home
          </Link>
        </Typography>
        <Typography variant="h6" sx={{ paddingLeft: "20px", marginBottom: "10px" }}>
          <Link href="/about" underline="hover">
            About
          </Link>
        </Typography>
        <Typography variant="h6" sx={{ paddingLeft: "20px", marginBottom: "10px" }}>
          <Link href="/changelog" underline="hover">
            Changelog
          </Link>
        </Typography>
        <Typography sx={{ paddingLeft: "20px", marginBottom: "10px", alignSelf: "center" }}>
          Last updated {config.last_updated}
        </Typography>
      </Box>
      <Typography variant="h6" sx={{ marginBottom: "10px" }}>
        {config.title}
      </Typography>
    </>
  );
};

export default Header;
