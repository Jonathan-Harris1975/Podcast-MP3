import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import ttsRouter from "./routes/tts.js"; // adjust path if needed

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Routes
app.use("/api/tts", ttsRouter);

// Health check (optional, Render likes this)
app.get("/", (req, res) => {
  res.send("Podcast TTS API is running 🚀");
});

// Start server
app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
