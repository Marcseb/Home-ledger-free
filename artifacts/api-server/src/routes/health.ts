import { Router, type IRouter } from "express";
import { HealthCheckResponse, VerifyDiscoveredServerBody } from "@workspace/api-zod";
import { getDiscoverySessionKey, isReviewerDemoMode } from "../lib/budget-store";
import { discoveryProof, getServerIdentity, serverVariant } from "../lib/server-discovery";

const router: IRouter = Router();
const challenges = new Map<string, { count: number; until: number }>();

router.get("/ping", (_req, res) => {
  res.set("Cache-Control", "no-store");
  res.json({ id: getServerIdentity(), product: "home-ledger", variant: serverVariant() });
});

router.post("/discovery/verify", (req, res): void => {
  res.set("Cache-Control", "no-store");
  const now = Date.now();
  for (const [key, value] of challenges) if (value.until <= now) challenges.delete(key);
  const key = req.ip ?? "unknown";
  const bucket = challenges.get(key) ?? { count: 0, until: now + 60_000 };
  if (bucket.count >= 60 || (!challenges.has(key) && challenges.size >= 1024)) {
    res.status(429).json({ error: "Try again shortly" }); return;
  }
  bucket.count++; challenges.set(key, bucket);
  const parsed = VerifyDiscoveredServerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Invalid discovery challenge" }); return; }
  const token = getDiscoverySessionKey(parsed.data);
  if (!token) { res.status(404).json({ error: "No matching device" }); return; }
  const id = getServerIdentity();
  const variant = serverVariant();
  res.json({ id, variant, proof: discoveryProof(token, parsed.data, id, variant) });
});

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    storage: isReviewerDemoMode() ? "postgresql" : "sqlite-wal",
    websocket: false,
  });
  res.json(data);
});

export default router;
