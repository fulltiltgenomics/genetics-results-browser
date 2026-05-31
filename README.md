# genetics-results-browser

Live browser available [here](https://annopublic.finngen.fi)

This is the frontend codebase for a variant annotation and interpretation web tool.

Running the tool requires running the [backend API](https://github.com/fulltiltgenomics/genetics-results-api).

## Development

### Install requirements

Install node modules:

```
npm install
```

### Build JavaScript bundle

Build a JavaScript bundle from TypeScript sources to `static/` in watch mode:

```
npm run dev
```

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
