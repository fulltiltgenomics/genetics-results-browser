import express, { type Express, type ErrorRequestHandler } from "express";
import { createPassthrough } from "./passthrough.js";
import { createVariantsRoute } from "./variantsRoute.js";

// turn express.json() body-parse failures into a clean JSON 400 instead of its default HTML
// stack-trace page (a malformed application/json body would otherwise leak internals)
const jsonParseErrorHandler: ErrorRequestHandler = (err, _req, res, next) => {
  if (err && (err.type === "entity.parse.failed" || err instanceof SyntaxError)) {
    res.status(400).json({ error: "invalid_json", message: "request body is not valid JSON" });
    return;
  }
  next(err);
};

// app factory kept separate from the listener so tests can mount it without binding a port
export const createApp = (): Express => {
  const app = express();

  // permissive CORS for dev only: the browser may call the BFF cross-origin when VITE_API_URL is
  // the absolute http://localhost:5000/api rather than the same-origin vite /api proxy. echo the
  // requesting origin (not "*") so credentialed XHR is allowed, and short-circuit preflights.
  // gated off in production because reflecting an arbitrary origin together with
  // Access-Control-Allow-Credentials:true is unsafe; prod serves the app same-origin behind a
  // reverse proxy (refactor.md §1) so no cross-origin CORS is needed there.
  const allowCorsReflection = process.env.NODE_ENV !== "production";
  app.use((req, res, next) => {
    if (allowCorsReflection) {
      const origin = req.headers.origin;
      if (origin) res.header("Access-Control-Allow-Origin", origin);
      res.header("Access-Control-Allow-Credentials", "true");
      res.header("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
      res.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
      if (req.method === "OPTIONS") {
        res.sendStatus(204);
        return;
      }
    }
    next();
  });

  // buffer JSON bodies (variant-list POSTs); large credible-set payloads need a generous limit
  app.use(express.json({ limit: "10mb" }));
  app.use(jsonParseErrorHandler);

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  // typed stage-1 normalize routes are mounted ahead of the generic passthrough so /v1/results
  // is assembled by the BFF; everything else under /api still falls through to genetics-results-api
  app.use("/api", createVariantsRoute());
  app.use("/api", createPassthrough());

  return app;
};
