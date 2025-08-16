// index.js
import express from "express";
import dotenv from "dotenv";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import http from "http";

import ttsRouter from "./routes/tts.js"; // ✅ only this route

// Load env vars
dotenv.config();

const app = express();
const server = http.createServer(app);

// ----------------------
// Middleware
// ----------------------
app.use(helmet());

// Use built-in body parsers
app.use(express.json({ limit: "5mb" }));
app.use(express.urlencoded({ extended: true }));

// CORS (adjust allowed origins for your frontend)
const allowedOrigins = [
  /\.render\.com$/,
  "http://localhost:3000",
  process.env.FRONTEND_URL, // e.g. https://myfrontend.com
].filter(Boolean);

app.use(
  cors({
    origin: (origin, cb) => {
      if (!origin) return cb(null, true); // allow curl / server-side
      if (
        allowedOrigins.some((o) =>
          o instanceof RegExp ? o.test(origin) : o === origin
        )
      ) {
        return cb(null, true);
      }
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// Rate limiting
const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 min
  max: 100, // max requests per IP
});
app.use(limiter);

// ----------------------
// Routes
// ----------------------
app.use("/api/tts", ttsRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({ status: "healthy", uptime: process.uptime() });
});

// ----------------------
// Error handling
// ----------------------
app.use((err, _req, res, _next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "Internal Server Error" });
});

// ----------------------
// Server setup
// ----------------------
const PORT = process.env.PORT || 3001;

// ⚠️ Cloudflare kills requests >100s. Use async jobs (done in routes/tts.js).
server.setTimeout(580000); // ~9m40s
app.use((req, res, next) => {
  res.setTimeout(580000, () => {
    console.warn("Request timed out:", req.originalUrl);
    res.status(503).json({ error: "Request timed out" });
  });
  next();
});

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
