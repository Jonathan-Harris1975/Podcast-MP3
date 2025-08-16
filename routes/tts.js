// routes/tts.js
import express from "express";
import fetch from "node-fetch";
import pLimit from "p-limit";
import textToSpeech from "@google-cloud/text-to-speech";
import { spawn } from "child_process";
import ffmpegPath from "ffmpeg-static";
import os from "os";
import fs from "fs/promises";
import path from "path";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { NodeHttpHandler } from "@smithy/node-http-handler";

const router = express.Router();

// ----------------------
// Setup Google TTS
// ----------------------
const googleCreds = JSON.parse(process.env.GOOGLE_KEY || "{}");
const ttsClient = new textToSpeech.TextToSpeechClient({
  projectId: googleCreds.project_id,
  credentials: {
    client_email: googleCreds.client_email,
    private_key: googleCreds.private_key,
  },
});

// ----------------------
// Setup R2 (S3 API)
// ----------------------
const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.R2_ENDPOINT,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
  },
  requestHandler: new NodeHttpHandler({
    requestTimeout: 120000,
    connectionTimeout: 30000,
  }),
});
const R2_BUCKET = process.env.R2_BUCKET_PODCAST; // final MP3s

// ----------------------
// Job store (in-memory)
// ----------------------
const jobs = new Map();

// ----------------------
// Helpers
// ----------------------
const FETCH_TIMEOUT_MS = +process.env.FETCH_TIMEOUT_MS || 10000;
const TTS_CONCURRENCY = +process.env.TTS_CONCURRENCY || 3;
const MAX_CHUNKS = +process.env.MAX_CHUNKS || 500;

function fetchWithTimeout(url, ms = FETCH_TIMEOUT_MS) {
  const ac = new AbortController();
  const id = setTimeout(() => ac.abort(), ms);
  return fetch(url, { signal: ac.signal }).finally(() => clearTimeout(id));
}

async function listChunkTexts(sessionId) {
  const base = process.env.R2_PUBLIC_BASE_URL_CHUNKS;
  if (!base) throw new Error("R2_PUBLIC_BASE_URL_CHUNKS not configured");

  const chunks = [];
  for (let i = 1; i <= MAX_CHUNKS; i++) {
    const url = `${base}/${sessionId}/chunk-${i}.txt`;
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) {
      if (i === 1) throw new Error(`No chunks found for ${sessionId}`);
      break;
    }
    const text = (await resp.text()).trim();
    if (text) chunks.push({ i, text });
  }
  return chunks;
}

async function mergeMp3WithFfmpeg(buffers) {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "merge-"));
  const listPath = path.join(tmp, "list.txt");
  const files = await Promise.all(
    buffers.map(async (b, i) => {
      const p = path.join(tmp, `p${i}.mp3`);
      await fs.writeFile(p, b);
      return p;
    })
  );
  await fs.writeFile(
    listPath,
    files.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join("\n")
  );

  const out = path.join(tmp, "out.mp3");
  await new Promise((resolve, reject) => {
    const ff = spawn(ffmpegPath, [
      "-hide_banner",
      "-y",
      "-f",
      "concat",
      "-safe",
      "0",
      "-i",
      listPath,
      "-c",
      "copy",
      out,
    ]);
    ff.on("error", reject);
    ff.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`))
    );
  });
  return fs.readFile(out);
}

async function synthesizeAllChunks(sessionId, jobs) {
  const job = jobs.get(sessionId);
  job.status = "running";
  jobs.set(sessionId, job);

  const chunks = await listChunkTexts(sessionId);
  const limit = pLimit(TTS_CONCURRENCY);
  const buffers = new Array(chunks.length);

  await Promise.all(
    chunks.map((c, idx) =>
      limit(async () => {
        const [resp] = await ttsClient.synthesizeSpeech(
          {
            input: { text: c.text },
            voice: { languageCode: "en-US", ssmlGender: "NEUTRAL" },
            audioConfig: { audioEncoding: "MP3" },
          },
          { timeout: 30000 }
        );
        buffers[idx] = Buffer.from(resp.audioContent, "base64");
        job.progress = Math.round(((idx + 1) / chunks.length) * 100);
        jobs.set(sessionId, job);
      })
    )
  );

  const merged = await mergeMp3WithFfmpeg(buffers);

  // upload to R2
  const key = `${sessionId}/final.mp3`;
  await s3.send(
    new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      Body: merged,
      ContentType: "audio/mpeg",
    })
  );

  job.status = "done";
  job.resultKey = key;
  jobs.set(sessionId, job);
}

// ----------------------
// Routes
// ----------------------

// Enqueue a new TTS job
router.post("/", (req, res) => {
  const { sessionId } = req.body || {};
  if (!sessionId) return res.status(400).json({ error: "sessionId is required" });

  if (!jobs.has(sessionId)) {
    jobs.set(sessionId, { status: "queued", progress: 0 });
    synthesizeAllChunks(sessionId, jobs).catch((err) => {
      const j = jobs.get(sessionId) || {};
      j.status = "error";
      j.error = err.message;
      jobs.set(sessionId, j);
    });
  }

  res.status(202).json({
    statusUrl: `/api/tts/${encodeURIComponent(sessionId)}/status`,
    resultUrl: `/api/tts/${encodeURIComponent(sessionId)}/audio`,
  });
});

// Poll job status
router.get("/:sessionId/status", (req, res) => {
  const job = jobs.get(req.params.sessionId);
  if (!job) return res.status(404).json({ error: "unknown sessionId" });
  res.json(job);
});

// Download final audio (when done)
router.get("/:sessionId/audio", async (req, res) => {
  const job = jobs.get(req.params.sessionId);
  if (!job || job.status !== "done") {
    return res.status(404).json({ error: "audio not ready" });
  }

  const obj = await s3.send(
    new GetObjectCommand({
      Bucket: R2_BUCKET,
      Key: job.resultKey,
    })
  );

  res.setHeader("Content-Type", "audio/mpeg");
  obj.Body.pipe(res);
});

export default router;
