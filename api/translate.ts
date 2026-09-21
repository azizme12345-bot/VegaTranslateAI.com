import { GoogleGenAI } from "@google/genai";

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: "Method not allowed" });
  }

  try {
    const { text, sourceLanguage, targetLanguage } = req.body || {};
    
    if (!text || !targetLanguage) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: "Server configuration error: GEMINI_API_KEY is missing." });
    }

    const ai = new GoogleGenAI({ 
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        }
      }
    });

    const prompt = `You are a professional, high-accuracy translator.
Translate the following input text directly into ${targetLanguage}${sourceLanguage && sourceLanguage !== "Auto Detect" ? ` from ${sourceLanguage}` : ""}.

Strict Requirements:
1. The translated text MUST strictly be in ${targetLanguage}.
2. For Urdu: Output MUST be in proper Urdu script (نستعلیق / اردو رسم الخط). Convert phonetic/Roman Urdu or Devanagari/Hindi into standard Urdu script.
3. For Hindi: Output MUST be in Devanagari script.
4. For English: Output MUST be in English.
5. Provide ONLY the translated output. Do NOT include quotes, pronunciation guides, transliterations, conversational preamble, or explanations.

Input text to translate:
"""
${text}
"""`;

    const MODELS_TO_TRY = ["gemini-3.1-flash-lite", "gemini-3.8-flash"];
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
          if (
            (translationText.startsWith('"') && translationText.endsWith('"')) ||
            (translationText.startsWith("'") && translationText.endsWith("'"))
          ) {
            translationText = translationText.slice(1, -1).trim();
          }
          break;
        }
      } catch (e) {
        // try next model
      }
    }

    if (!translationText) {
      return res.status(500).json({ error: "Failed to generate translation" });
    }

    return res.status(200).json({ translation: translationText });
  } catch (error: any) {
    console.error("Vercel translate error:", error);
    return res.status(500).json({ error: error.message || "Failed to translate" });
  }
}
