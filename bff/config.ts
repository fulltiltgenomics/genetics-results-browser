// BFF configuration read from the environment so nothing upstream is hardcoded.
// GENETICS_API_URL    base URL of the upstream genetics-results-api (incl. /api prefix)
// GENETICS_API_TOKEN  shared internal secret; sent as `Authorization: Bearer` on the BFF's own
//                     server-to-server calls so an auth-enforcing API (REQUIRE_AUTH) accepts them.
//                     unset in dev (the dev API runs without auth); set from the k8s secret in prod.
// BFF_PORT            port this service listens on (browser -> BFF -> genetics-results-api)

export const config = {
  // upstream already includes the /api path segment, matching the prod VITE_API_URL contract
  upstreamUrl: (process.env.GENETICS_API_URL ?? "http://localhost:2000/api").replace(/\/+$/, ""),
  apiToken: process.env.GENETICS_API_TOKEN ?? "",
  // 5000 by default: 2000=API, 3000=vite dev server, 4000=chat backend are all taken in dev
  port: Number(process.env.BFF_PORT ?? 5000),
};
