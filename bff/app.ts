import express, { type Express } from "express";
import { createPassthrough } from "./passthrough.js";

// app factory kept separate from the listener so tests can mount it without binding a port
export const createApp = (): Express => {
  const app = express();

  // buffer JSON bodies (variant-list POSTs); large credible-set payloads need a generous limit
  app.use(express.json({ limit: "10mb" }));

  app.get("/healthz", (_req, res) => {
    res.json({ status: "ok" });
  });

  // mounted at /api so the browser's VITE_API_URL (.../api) + axios paths (/v1/...) line up
  // with the upstream genetics-results-api which also lives under /api
  app.use("/api", createPassthrough());

  return app;
};
