import express from "express";
import path from "path";
import fs from "fs";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";
import AdmZip from "adm-zip";

dotenv.config();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Health check routes
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/health", (req, res) => {
    res.status(200).send("OK");
  });

  // Audio Text-to-Speech proxy fallback for natural voice playback with intelligent chunking
  app.get("/api/tts", async (req, res) => {
    try {
      const text = String(req.query.text || "").trim();
      const lang = String(req.query.lang || "ur").toLowerCase().split('-')[0];
      if (!text) {
        return res.status(400).send("Text parameter is required");
      }

      // Google translate_tts limits query to ~100 characters. Chunk the text cleanly.
      const rawSentences = text.match(/[^.!?۔،\n]+[.!?۔،\n]*|\S+/g) || [text];
      const chunks: string[] = [];
      let currentChunk = "";

      for (const s of rawSentences) {
        if ((currentChunk + " " + s).trim().length <= 90) {
          currentChunk = (currentChunk + " " + s).trim();
        } else {
          if (currentChunk) chunks.push(currentChunk);
          if (s.length <= 90) {
            currentChunk = s.trim();
          } else {
            const words = s.split(/\s+/);
            let wordChunk = "";
            for (const w of words) {
              if ((wordChunk + " " + w).trim().length <= 90) {
                wordChunk = (wordChunk + " " + w).trim();
              } else {
                if (wordChunk) chunks.push(wordChunk);
                wordChunk = w;
              }
            }
            currentChunk = wordChunk;
          }
        }
      }
      if (currentChunk) chunks.push(currentChunk);

      const bufferPromises = chunks.slice(0, 15).map(async (chunk) => {
        const ttsUrl = `https://translate.google.com/translate_tts?ie=UTF-8&client=tw-ob&tl=${encodeURIComponent(lang)}&q=${encodeURIComponent(chunk)}`;
        const audioRes = await fetch(ttsUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
          }
        });
        if (!audioRes.ok) {
          throw new Error(`Google TTS status: ${audioRes.status}`);
        }
        return Buffer.from(await audioRes.arrayBuffer());
      });

      const audioBuffers = await Promise.all(bufferPromises);
      const combined = Buffer.concat(audioBuffers);

      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.setHeader("Content-Length", combined.length.toString());
      res.send(combined);
    } catch (err: any) {
      console.warn("TTS fetch error:", err?.message || err);
      res.status(500).send("TTS Error");
    }
  });

  app.post("/api/translate", async (req, res) => {
    try {
      const { text, sourceLanguage, targetLanguage } = req.body;
      
      if (!text || !targetLanguage) {
        return res.status(400).json({ error: "Missing required fields" });
      }

      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({ error: "Server configuration error: GEMINI_API_KEY is missing." });
      }

      const ai = new GoogleGenAI({ 
        apiKey: process.env.GEMINI_API_KEY,
        httpOptions: {
          headers: {
            'User-Agent': 'aistudio-build',
          }
        }
      });

      const MODELS_TO_TRY = [
        "gemini-3.1-flash-lite",
        "gemini-3.8-flash"
      ];

      const prompt = `You are a professional, high-accuracy translator.
Translate the following input text directly into ${targetLanguage}${sourceLanguage && sourceLanguage !== "Auto Detect" ? ` from ${sourceLanguage}` : ""}.

Strict Requirements:
1. The translated text MUST strictly be in ${targetLanguage}.
2. For Urdu: Output MUST be in proper Urdu script (نستعلیق / اردو رسم الخط). Convert phonetic/Roman Urdu or Devanagari/Hindi into standard Urdu script.
3. For Hindi: Output MUST be in Devanagari script.
4. For English: Output MUST be in English.
5. For Arabic: Output MUST be in Arabic script.
6. Provide ONLY the translated output. Do NOT include quotes, pronunciation guides, transliterations, conversational preamble, or explanations.

Input text to translate:
"""
${text}
"""`;

      let lastError: any = null;
      let translationText = "";

      for (const modelName of MODELS_TO_TRY) {
        try {
          const response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
              temperature: 0.1,
            }
          });

          if (response.text) {
            translationText = response.text.trim();
            // Remove accidental surrounding quotation marks
            if (
              (translationText.startsWith('"') && translationText.endsWith('"')) ||
              (translationText.startsWith('“') && translationText.endsWith('”')) ||
              (translationText.startsWith('\'') && translationText.endsWith('\''))
            ) {
              translationText = translationText.slice(1, -1).trim();
            }
            break;
          }
        } catch (modelErr: any) {
          console.warn(`Model ${modelName} failed, attempting fallback...`, modelErr?.message || modelErr);
          lastError = modelErr;
        }
      }

      if (!translationText && lastError) {
        throw lastError;
      }

      res.json({ translation: translationText });
    } catch (error: any) {
      console.error("Translation error:", error);
      let errMsg = "Failed to translate text";
      if (error.message) {
         try {
            const parsed = JSON.parse(error.message);
            if (parsed.error && parsed.error.message) {
               errMsg = parsed.error.message;
            } else {
               errMsg = error.message;
            }
         } catch {
            errMsg = error.message;
         }
      }
      res.status(500).json({ error: errMsg });
    }
  });

  app.get("/api/download-zip", (req, res) => {
    try {
      const zip = new AdmZip();

      function addDirToZip(currentDir: string, zipRelativePath: string) {
        const files = fs.readdirSync(currentDir);
        for (const file of files) {
          if (
            file === "node_modules" ||
            file === "dist" ||
            file === ".git" ||
            file === ".env" ||
            file.endsWith(".log")
          ) {
            continue;
          }
          const fullPath = path.join(currentDir, file);
          const stat = fs.statSync(fullPath);
          if (stat.isDirectory()) {
            addDirToZip(fullPath, zipRelativePath ? `${zipRelativePath}/${file}` : file);
          } else {
            zip.addLocalFile(fullPath, zipRelativePath || "");
          }
        }
      }

      addDirToZip(process.cwd(), "");

      const buffer = zip.toBuffer();
      res.setHeader("Content-Type", "application/zip");
      res.setHeader("Content-Disposition", 'attachment; filename="ai-translator.zip"');
      res.setHeader("Content-Length", buffer.length);
      res.send(buffer);
    } catch (err: any) {
      console.error("Zip download error:", err);
      if (!res.headersSent) {
        res.status(500).json({ error: "Failed to generate zip" });
      }
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    // In production, find the static dist directory
    const candidates = [
      path.join(process.cwd(), "dist"),
      path.join(process.cwd(), "applet", "dist"),
      path.join(process.cwd(), "..", "dist"),
    ];
    const distPath = candidates.find((dir) => fs.existsSync(path.join(dir, "index.html"))) || path.join(process.cwd(), "dist");

    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      if (req.path.startsWith("/api")) {
        return res.status(404).json({ error: "Endpoint not found" });
      }
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
