import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    customLogLevel(req, res, err) {
      if (err || res.statusCode >= 500) return "error";
      if (res.statusCode === 404 && req.url?.split("?")[0] === "/") return "silent";
      if (res.statusCode >= 400) return "warn";
      return "silent";
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ origin: false }));
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
