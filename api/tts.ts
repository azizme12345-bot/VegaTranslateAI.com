export default async function handler(req: any, res: any) {
  try {
    const text = String(req.query.text || "").trim();
    const lang = String(req.query.lang || "ur").toLowerCase().split('-')[0];
    if (!text) {
      return res.status(400).send("Text parameter is required");
    }

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
    console.warn("Vercel TTS fetch error:", err?.message || err);
    res.status(500).send("TTS Error");
  }
}
