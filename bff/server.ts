import { createApp } from "./app.js";
import { config } from "./config.js";

const app = createApp();

app.listen(config.port, () => {
  console.log(`[bff] listening on http://localhost:${config.port}`);
  console.log(`[bff] forwarding /api -> ${config.upstreamUrl}`);
});
