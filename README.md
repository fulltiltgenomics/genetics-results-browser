# genetics-results-browser

Live browser available [here](https://annopublic.finngen.fi)

This is the frontend codebase for a variant annotation and interpretation web tool. It also
contains the BFF (backend-for-frontend) in `bff/`, a small Express service that assembles the
annotation tool's per-query data from the backend API and proxies everything else through.

Running the tool requires running the [backend API](https://github.com/fulltiltgenomics/genetics-results-api).
The chat views additionally require the chat backend (`../genetics-mcp-server`).

## Development

### Install requirements

Install node modules:

```
npm install
```

### Dev server and production build

Run the Vite dev server on `:3000` (hot module reload, nothing written to disk):

```
npm run dev
```

Build a production bundle from the TypeScript sources into `static/`:

```
npm run build
```

### Environment variables

Vite always loads the gitignored `.env.local`. The checked-in `.env.<mode>` files are only loaded
when the mode is named explicitly, e.g. `npm run dev -- --mode dev.public` loads `.env.dev.public`.
Available modes: `dev`, `dev.finngen`, `dev.public`, `prod`, `prod.finngen`, `prod.public`.

| variable | meaning |
| --- | --- |
| `VITE_TARGET` | `finngen` (requires auth) or `public` |
| `VITE_API_URL` | base URL of the BFF, e.g. `http://localhost:5000/api` |
| `VITE_CHAT_URL` | base URL of the chat backend, e.g. `http://localhost:4000/chat` |
| `VITE_APP_NAME` | product name shown in the UI, defaults to `FinnGenie` |

The BFF reads `GENETICS_API_URL`, `GENETICS_API_TOKEN`, `BFF_PORT`, `RESULTS_CACHE_MAX` and
`RESULTS_CACHE_TTL_MS` — see `bff/.env.example`.

### Local dev startup sequence

In development the data flow is: browser → Vite (`:3000`) → BFF (`:5000`) → genetics-results-api (`:2000`).

`VITE_API_URL` points at the BFF, so `npm run dev` alone won't serve data. You need three processes running:

```
# 1. genetics-results-api on :2000, started separately from ../genetics-results-api
# 2. the BFF on :5000
npm run bff:dev
# 3. the Vite dev server on :3000
npm run dev
```

The chat views do not go through the BFF — they call the chat backend directly at `VITE_CHAT_URL`.
Since the landing page (`/`) is the chat, that backend (from `../genetics-mcp-server`, listening on
the port `VITE_CHAT_URL` names) is a fourth process needed for a fully working app.

### Type checking and tests

```
npm run typecheck # tsc --noEmit over src/
npm test          # vitest unit/component tests under src/ (jsdom, MSW-mocked API)
npm run bff:test  # vitest tests for the BFF
npm run e2e       # Playwright end-to-end specs in e2e/ (headless chromium)
```

`npm run build` does not check types — Vite strips them during the build — so `npm run
typecheck` is what catches type errors. Pull requests run it in CI before the build. It
covers `src/` only; `bff/` is not type-checked (see `CLAUDE.md` for why).

`npm run e2e` reuses an already-running dev server, or starts one in `dev.public` mode; specs that
need real data still require the API and the BFF to be up.

### Docker images

The frontend image builds the bundle and serves `static/` with nginx. The env file and the data
config baked in are selected by build args:

```
docker build --build-arg DEPLOY_ENV=prod --build-arg DATA_SOURCE=public \
  --build-arg APP_NAME=FinnGenie -t genetics-results-browser .
```

`DEPLOY_ENV` (`dev`/`prod`) and `DATA_SOURCE` (`finngen`/`public`) pick `.env.$DEPLOY_ENV.$DATA_SOURCE`,
`src/config.$DATA_SOURCE.json` and `nginx.$DEPLOY_ENV.conf`.

The BFF has its own image, built from the repo root:

```
docker build -f bff/Dockerfile -t genetics-results-bff .
```
