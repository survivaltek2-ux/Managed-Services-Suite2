import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import path from "path";
import { existsSync } from "fs";
import { rateLimit } from "express-rate-limit";
import { authMiddleware } from "./middlewares/authMiddleware.js";
import router from "./routes/index.js";
import seoRouter from "./routes/seo.js";

// ─── Rate limiters for public / high-risk endpoints ──────────────────────────

// Public forms: prevent email spam and account flooding
const publicFormLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many requests, please try again later." },
});

// Quote form: extra strict — auto-provisions accounts and sends welcome emails
const quoteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 3,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many quote requests, please try again later." },
});

// Auth registration: prevent mass account creation
const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  limit: 5,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many registration attempts, please try again later." },
});

// Service availability: each request fans out to several paid third-party APIs
const serviceAvailabilityLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  limit: 10,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "Too many availability lookups, please try again later." },
});

declare global {
  namespace Express {
    interface Request {
      rawBody?: Buffer;
    }
  }
}

const app: Express = express();
const workspaceRoot = process.cwd();
const marketingDist = path.resolve(workspaceRoot, "artifacts", "siebert-services", "dist", "public");
const partnerDist = path.resolve(workspaceRoot, "artifacts", "partner-portal", "dist", "public");
const marketingIndex = path.join(marketingDist, "index.html");
const partnerIndex = path.join(partnerDist, "index.html");
const staticOptions = {
  index: false,
  extensions: ["html"],
};

app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());

const WEBHOOK_MAX_BYTES = 1 * 1024 * 1024;

function captureRawBody(req: Request, _res: Response, buf: Buffer): void {
  if (
    req.path.startsWith("/api/webhooks/tsd/") ||
    req.path.startsWith("/api/webhooks/zoom/") ||
    req.path.startsWith("/api/webhooks/stripe") ||
    req.path === "/api/webhooks/partnerstack" ||
    req.path === "/api/esign/webhook"
  ) {
    req.rawBody = Buffer.from(buf);
  }
}

app.use(express.json({ limit: "15mb", verify: captureRawBody }));
app.use(express.urlencoded({ extended: true, limit: "15mb" }));

app.use((req: Request, res: Response, next: NextFunction) => {
  if (
    req.rawBody &&
    (req.path.startsWith("/api/webhooks/tsd/") || req.path.startsWith("/api/webhooks/zoom/") || req.path.startsWith("/api/webhooks/stripe") || req.path === "/api/webhooks/partnerstack" || req.path === "/api/esign/webhook") &&
    req.rawBody.length > WEBHOOK_MAX_BYTES
  ) {
    res.status(413).json({ error: "payload_too_large" });
    return;
  }
  next();
});
app.use(authMiddleware);

// Apply rate limiters to specific public/expensive endpoints before the main router
app.post("/api/contact", publicFormLimiter);
app.post("/api/lead-magnets/submit", publicFormLimiter);
app.post("/api/quotes", quoteLimiter);
app.post("/api/auth/register", registerLimiter);
app.get("/api/service-availability", serviceAvailabilityLimiter);

app.use("/api", router);

// SEO routes served at the site root (sitemap.xml, robots.txt)
app.use(seoRouter);

if (existsSync(partnerIndex)) {
  app.use("/partners", express.static(partnerDist, staticOptions));
  app.get(/^\/partners(\/.*)?$/, (_req, res) => {
    res.sendFile(partnerIndex);
  });
}

if (existsSync(marketingIndex)) {
  app.use(express.static(marketingDist, staticOptions));
  app.get(/^\/(admin|portal|blog|case-studies|services|zoom|about|contact|quote|resources|welcome|pricing)(\/.*)?$/, (_req, res) => {
    res.sendFile(marketingIndex);
  });
  app.get(/^\/proposal\/.*$/, (_req, res) => {
    res.sendFile(marketingIndex);
  });
  app.get("/", (_req, res) => {
    res.sendFile(marketingIndex);
  });
}

export default app;
