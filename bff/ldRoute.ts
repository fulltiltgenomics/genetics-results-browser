import { Router, type Request, type Response } from "express";
import { config } from "./config.js";

// the LD service is slower than genetics-results-api (a 1.5Mb window is ~700KB of JSON and takes a
// couple of seconds), so it gets a longer leash than upstream.ts's 30s default
const LD_TIMEOUT_MS = 60_000;

// the LD panel is a fixed set of reference panels on the LD server; constrain the value rather than
// forwarding arbitrary user text into the upstream query string
const PANEL_RE = /^[A-Za-z0-9_-]+$/;
// the LD server's own accepted window range ("window must be between 100000 and 5000000"); mirrored
// here so an out-of-range value fails with a message the UI can show instead of an upstream HTML 400
const MIN_WINDOW_BP = 100_000;
const MAX_WINDOW_BP = 5_000_000;

const badRequest = (res: Response, message: string): void => {
  res.status(400).json({ error: "bad_request", message });
};

/**
 * Server-side proxy for the FinnGen LD API (genetics-results-suite: the frontend CSP is
 * `connect-src 'self'`, so the browser cannot call api.finngen.fi directly — it did until the CSP
 * landed, and every LD lookup then failed with "Failed to fetch"). Keeping the call here also means
 * the user's variant never leaves the deployment's own hop, and the LD host is configured in one
 * place (LD_API_URL) instead of being baked into the bundle.
 *
 * GET /v1/ld?variant=<chr:pos:ref:alt>&window=<bp>&panel=<panel>&r2_thresh=<0-1>
 * Returns the upstream body unchanged: { ld: [{ variation1, variation2, d_prime, r2 }, ...] }.
 */
export const createLdRoute = (): Router => {
  const router = Router();

  router.get("/v1/ld", async (req: Request, res: Response) => {
    const variant = typeof req.query.variant === "string" ? req.query.variant.trim() : "";
    if (variant === "") {
      badRequest(res, "missing 'variant'");
      return;
    }

    const query = new URLSearchParams({ variant });

    if (req.query.window !== undefined) {
      const window = Number(req.query.window);
      if (!Number.isFinite(window) || window < MIN_WINDOW_BP || window > MAX_WINDOW_BP) {
        badRequest(res, `window must be between ${MIN_WINDOW_BP} and ${MAX_WINDOW_BP}`);
        return;
      }
      query.set("window", String(Math.round(window)));
    }

    if (req.query.panel !== undefined) {
      const panel = String(req.query.panel);
      if (!PANEL_RE.test(panel)) {
        badRequest(res, "'panel' must be alphanumeric");
        return;
      }
      query.set("panel", panel);
    }

    if (req.query.r2_thresh !== undefined) {
      const r2 = Number(req.query.r2_thresh);
      if (!Number.isFinite(r2) || r2 < 0 || r2 > 1) {
        badRequest(res, "'r2_thresh' must be a number between 0 and 1");
        return;
      }
      query.set("r2_thresh", String(r2));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LD_TIMEOUT_MS);

    try {
      const upstream = await fetch(`${config.ldApiUrl}?${query.toString()}`, {
        signal: controller.signal,
      });

      // 400 (unparseable variant) and 404 (variant not in the panel) are answers about the user's
      // input, so they survive the hop; anything else upstream is our problem, not theirs
      if (!upstream.ok) {
        if (upstream.status === 400 || upstream.status === 404) {
          res.status(upstream.status).json({
            error: upstream.status === 404 ? "not_found" : "bad_request",
            message: upstream.status === 404 ? "variant not found" : "invalid variant",
          });
          return;
        }
        console.error(`[bff] ld upstream ${upstream.status} for ${variant}`);
        res.status(502).json({ error: "bad_gateway", message: `LD API error ${upstream.status}` });
        return;
      }

      const body = await upstream.text();
      res.type("application/json").send(body);
    } catch (err) {
      const timedOut = (err as Error)?.name === "AbortError";
      console.error(`[bff] ld ${timedOut ? "timeout" : "error"} for ${variant}:`, err);
      res
        .status(timedOut ? 504 : 502)
        .json({
          error: timedOut ? "gateway_timeout" : "bad_gateway",
          message: timedOut ? "LD API timed out" : "LD API unreachable",
        });
    } finally {
      clearTimeout(timer);
    }
  });

  return router;
};
