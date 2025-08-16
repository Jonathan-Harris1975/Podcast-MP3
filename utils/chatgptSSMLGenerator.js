// utils/chatgptSSMLGenerator.js
// Minimal-token hybrid SSML enhancer with retry + cache

import axios from "axios";
import { buildDeterministicSSMLChunks } from "./ssmlTools.js";

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const _cache = new Map();

// Hardcoded settings
const SSML_MODE = "hybrid"; // deterministic | hybrid | chatgpt
const MAX_SSML_CHUNK_BYTES = 3400;
const OPENAI_MODEL = "gpt-4o-mini";
const GPT_TEMPERATURE = 0.3;

function headers() {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${OPENAI_API_KEY}`,
  };
}

async function callOpenAIChunk(text) {
  const cached = _cache.get(text);
  if (cached) return cached;

  let attempt = 0;
  while (attempt < 5) {
    try {
      const resp = await axios.post(
        "https://api.openai.com/v1/chat/completions",
        {
          model: OPENAI_MODEL,
          temperature: GPT_TEMPERATURE,
          messages: [
            {
              role: "system",
              content:
                "You are a voice SSML assistant. Take valid SSML input and make small refinements: add <emphasis>, <break>, or <prosody> only where useful. Do not change meaning.",
            },
            { role: "user", content: text },
          ],
        },
        { headers: headers(), timeout: 30000 }
      );

      const content = resp?.data?.choices?.[0]?.message?.content || "";
      _cache.set(text, content);
      return content;
    } catch (err) {
      if (
        err.response &&
        err.response.status === 429 &&
        attempt < 4
      ) {
        const retryAfter = parseInt(
          err.response.headers["retry-after"] || "2",
          10
        );
        const backoff = Math.pow(2, attempt) * 1000 + retryAfter * 1000;
        await new Promise((res) => setTimeout(res, backoff));
        attempt++;
        continue;
      }
      console.error("OpenAI call failed:", err.message);
      return text;
    }
  }
  return text;
}

export async function generateDynamicSSML(text) {
  const baseChunks = buildDeterministicSSMLChunks(text, MAX_SSML_CHUNK_BYTES);

  if (SSML_MODE === "deterministic" || !OPENAI_API_KEY) {
    return baseChunks;
  }

  if (SSML_MODE === "chatgpt") {
    const out = [];
    for (const ch of baseChunks) {
      out.push(await callOpenAIChunk(ch));
    }
    return out;
  }

  // hybrid mode
  const out = [];
  for (const ch of baseChunks) {
    const refined = await callOpenAIChunk(ch);
    if (
      Buffer.byteLength(refined, "utf8") <= MAX_SSML_CHUNK_BYTES &&
      refined.includes("<speak>")
    ) {
      out.push(refined);
    } else {
      out.push(ch);
    }
  }
  return out;
}
