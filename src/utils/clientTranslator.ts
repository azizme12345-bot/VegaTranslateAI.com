// Client-side translation fallback for static hosting environments like GitHub Pages
// where no Node.js/Express backend server is running.

const LANGUAGE_CODE_MAP: Record<string, string> = {
  "Auto Detect": "autodetect",
  "English": "en",
  "Urdu": "ur",
  "Hindi": "hi",
  "Punjabi": "pa",
  "Japanese": "ja",
  "Chinese": "zh",
  "Korean": "ko",
  "French": "fr",
  "German": "de",
  "Spanish": "es",
  "Italian": "it",
  "Portuguese": "pt",
  "Russian": "ru",
  "Turkish": "tr",
  "Persian": "fa",
  "Bengali": "bn",
  "Indonesian": "id",
  "Malay": "ms",
  "Arabic": "ar"
};

function decodeHtmlEntities(str: string): string {
  const txt = document.createElement("textarea");
  txt.innerHTML = str;
  return txt.value;
}

export function detectLanguage(text: string): string {
  // Check for Arabic/Urdu/Persian characters
  if (/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text)) {
    return "ur";
  }
  // Check for Japanese
  if (/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff]/.test(text)) {
    return "ja";
  }
  // Check for Hindi/Devanagari
  if (/[\u0900-\u097F]/.test(text)) {
    return "hi";
  }
  // Check for Bengali
  if (/[\u0980-\u09FF]/.test(text)) {
    return "bn";
  }
  // Default to English
  return "en";
}

export async function translateClientSide(
  text: string,
  sourceLanguage: string,
  targetLanguage: string
): Promise<string> {
  let sourceCode = LANGUAGE_CODE_MAP[sourceLanguage] || "autodetect";
  const targetCode = LANGUAGE_CODE_MAP[targetLanguage] || "en";

  if (sourceCode === "autodetect") {
    sourceCode = detectLanguage(text);
    // If detected is same as target, flip target
    if (sourceCode === targetCode) {
      sourceCode = targetCode === "ur" ? "en" : "ur";
    }
  }

  // Method 1: If client-side Gemini API key is provided via VITE_GEMINI_API_KEY
  const viteGeminiKey = (import.meta as any).env?.VITE_GEMINI_API_KEY;
  if (viteGeminiKey) {
    try {
      const { GoogleGenAI } = await import("@google/genai");
      const ai = new GoogleGenAI({ apiKey: viteGeminiKey });
      const prompt = `Translate the following text into ${targetLanguage}${
        sourceLanguage && sourceLanguage !== "Auto Detect" ? ` from ${sourceLanguage}` : ""
      }.
Output ONLY the raw translation in the appropriate native script without quotes or explanation:
"""
${text}
"""`;
      const res = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite",
        contents: prompt,
      });
      if (res.text && res.text.trim()) {
        return res.text.trim();
      }
    } catch (geminiErr) {
      console.warn("Client Gemini fallback failed, trying public translation API...", geminiErr);
    }
  }

  // Method 2: Public Translation API
  const langPair = `${sourceCode}|${targetCode}`;
  const apiUrl = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(langPair)}`;

  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Translation service returned HTTP ${response.status}`);
  }

  const data = await response.json();
  if (data?.responseData?.translatedText) {
    const raw = data.responseData.translatedText;
    // Decode HTML entities (e.g. &#39; -> ')
    return decodeHtmlEntities(raw);
  }

  throw new Error("Unable to translate text. Please verify network connection.");
}
