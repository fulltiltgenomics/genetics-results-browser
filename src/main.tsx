import { createRoot } from "react-dom/client";
import { App } from "./App";
import { APP_NAME } from "./config/appName";

document.title = APP_NAME;

const container = document.getElementById("reactEntry");
const root = createRoot(container!);

root.render(<App />);
