import React, { useState, useEffect, useRef } from 'react';
import { ArrowRightLeft, Mic, MicOff, Volume2, Copy, Trash2, Loader2, Square, History, Clock, ExternalLink } from 'lucide-react';
import { LANGUAGES, TARGET_LANGUAGES } from '../constants';
import { translateClientSide } from '../utils/clientTranslator';
import { TranslationHistoryItem } from '../types';
import { saveTranslationToHistory, getTranslationHistory } from '../utils/historyStorage';

// Declare types for Web Speech API
declare global {
  interface Window {
    SpeechRecognition: any;
    webkitSpeechRecognition: any;
  }
}

interface TranslatorProps {
  initialItem?: TranslationHistoryItem | null;
  onOpenHistory?: () => void;
}

const getLanguageCode = (languageName: string): string => {
  const map: Record<string, string> = {
    "English": "en-US",
    "Urdu": "ur-PK",
    "Punjabi": "pa-PK",
    "Japanese": "ja-JP",
    "Hindi": "hi-IN",
    "Arabic": "ar-SA",
    "French": "fr-FR",
    "German": "de-DE",
    "Spanish": "es-ES",
    "Chinese": "zh-CN",
    "Korean": "ko-KR",
    "Italian": "it-IT",
    "Portuguese": "pt-BR",
    "Russian": "ru-RU",
    "Turkish": "tr-TR",
    "Persian": "fa-IR",
    "Bengali": "bn-BD",
    "Indonesian": "id-ID",
    "Malay": "ms-MY"
  };
  return map[languageName] || "en-US";
};

// Selects the highest quality, most natural sounding voice for Urdu and English
const getOptimalVoice = (langCode: string, synth: SpeechSynthesis): SpeechSynthesisVoice | null => {
  const voices = synth.getVoices();
  if (!voices || voices.length === 0) return null;

  const targetLangLower = langCode.toLowerCase();
  const prefix = targetLangLower.split('-')[0];

  if (prefix === 'ur') {
    // 1. Direct Urdu voice (Google اردو, Microsoft Asad, Microsoft Uzma, etc.)
    const directUrdu = voices.find(v => {
      const l = v.lang.replace('_', '-').toLowerCase();
      const n = v.name.toLowerCase();
      return l.startsWith('ur') || n.includes('urdu');
    });
    if (directUrdu) return directUrdu;

    // 2. High-quality natural Hindi voice (shared phonology in TTS engines produces clear Urdu)
    const naturalHindi = voices.find(v => {
      const l = v.lang.replace('_', '-').toLowerCase();
      const n = v.name.toLowerCase();
      return (l.startsWith('hi') || n.includes('hindi')) && 
             (n.includes('google') || n.includes('natural') || n.includes('neural') || n.includes('online'));
    }) || voices.find(v => v.lang.replace('_', '-').toLowerCase().startsWith('hi'));
    if (naturalHindi) return naturalHindi;
  }

  if (prefix === 'en') {
    // Prioritize natural, fluent English voices (Google US English, Natural, Neural, Jenny, Samantha)
    const naturalEnglish = voices.find(v => {
      const l = v.lang.replace('_', '-').toLowerCase();
      const n = v.name.toLowerCase();
      return l.startsWith('en') &&
        (n.includes('natural') || n.includes('google') || n.includes('neural') || n.includes('jenny') || n.includes('guy') || n.includes('samantha') || n.includes('aria'));
    });
    if (naturalEnglish) return naturalEnglish;
  }

  // Exact match
  const exact = voices.find(v => v.lang.replace('_', '-').toLowerCase() === targetLangLower);
  if (exact) return exact;

  // Prefix match
  return voices.find(v => v.lang.replace('_', '-').toLowerCase().startsWith(prefix)) || null;
};

export default function Translator({ initialItem, onOpenHistory }: TranslatorProps = {}) {
  const [sourceLanguage, setSourceLanguage] = useState<string>("Auto Detect");
  const [targetLanguage, setTargetLanguage] = useState<string>("English");
  const [inputText, setInputText] = useState("");
  const [outputText, setOutputText] = useState("");
  const [isTranslating, setIsTranslating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [recentHistory, setRecentHistory] = useState<TranslationHistoryItem[]>([]);
  
  // Speech Recognition State
  const [isListening, setIsListening] = useState(false);
  const [voiceLang, setVoiceLang] = useState<'auto' | 'ur' | 'en'>('auto');
  const recognitionRef = useRef<any>(null);
  const restartTimerRef = useRef<any>(null);
  const baseTextRef = useRef<string>("");
  const isStoppingRef = useRef<boolean>(false);
  const isListeningRef = useRef<boolean>(false);

  // Speech Synthesis & Audio State
  const [speakingTarget, setSpeakingTarget] = useState<'input' | 'output' | null>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const activeUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Load history from localStorage
  const refreshHistory = () => {
    setRecentHistory(getTranslationHistory());
  };

  useEffect(() => {
    refreshHistory();
    const onHistChange = () => refreshHistory();
    window.addEventListener('translation-history-changed', onHistChange);
    return () => {
      window.removeEventListener('translation-history-changed', onHistChange);
    };
  }, []);

  // When an item is passed from the History page, load it
  useEffect(() => {
    if (initialItem) {
      setInputText(initialItem.sourceText);
      setOutputText(initialItem.translatedText);
      setSourceLanguage(initialItem.sourceLanguage);
      setTargetLanguage(initialItem.targetLanguage);
      setError(null);
    }
  }, [initialItem]);

  useEffect(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      synthRef.current = window.speechSynthesis;
      // Pre-load available voices
      window.speechSynthesis.getVoices();
      const onVoicesChanged = () => {
        if (synthRef.current) {
          synthRef.current.getVoices();
        }
      };
      window.speechSynthesis.onvoiceschanged = onVoicesChanged;
    }

    return () => {
      cleanupRecognition();
      if (synthRef.current) {
        try {
          synthRef.current.cancel();
        } catch (e) {}
      }
      if (audioRef.current) {
        try {
          audioRef.current.pause();
          audioRef.current = null;
        } catch (e) {}
      }
    };
  }, []);

  const cleanupRecognition = () => {
    isListeningRef.current = false;
    if (restartTimerRef.current) {
      clearTimeout(restartTimerRef.current);
      restartTimerRef.current = null;
    }
    if (recognitionRef.current) {
      const rec = recognitionRef.current;
      recognitionRef.current = null;
      rec.onstart = null;
      rec.onresult = null;
      rec.onerror = null;
      rec.onend = null;
      try {
        rec.stop();
      } catch (e) {
        try {
          rec.abort();
        } catch (e2) {}
      }
    }
  };

  const handleSwapLanguages = () => {
    if (isListening) {
      stopListening();
    }
    stopSpeaking();
    if (sourceLanguage === "Auto Detect") {
      setSourceLanguage(targetLanguage);
      setTargetLanguage("English"); // Default fallback
    } else {
      setSourceLanguage(targetLanguage);
      setTargetLanguage(sourceLanguage);
    }
    
    // Swap text
    const oldInput = inputText;
    setInputText(outputText);
    setOutputText(oldInput);
  };

  const stopListening = () => {
    isStoppingRef.current = true;
    isListeningRef.current = false;
    setIsListening(false);
    cleanupRecognition();
  };

  const initRecognition = () => {
    if (!isListeningRef.current || isStoppingRef.current) return;

    // Clean up any lingering instance before instantiating fresh session
    if (recognitionRef.current) {
      const oldRec = recognitionRef.current;
      recognitionRef.current = null;
      oldRec.onstart = null;
      oldRec.onresult = null;
      oldRec.onerror = null;
      oldRec.onend = null;
      try { oldRec.stop(); } catch (e) {}
    }

    const SpeechRecognition =
      (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsListening(false);
      isListeningRef.current = false;
      setError("صوتی ان پٹ (Voice Input) کے لیے گوگل کروم (Google Chrome) یا مائیکروسافٹ ایج (Edge) استعمال کریں۔ (Please use Google Chrome or Edge for voice input).");
      return;
    }

    try {
      const recognition = new SpeechRecognition();
      recognition.continuous = false; // continuous = false ensures high reliability across all devices
      recognition.interimResults = true;
      recognition.maxAlternatives = 1;

      // Determine speech recognition language
      let langCode = "ur-PK";
      if (voiceLang === "ur") {
        langCode = "ur-PK";
      } else if (voiceLang === "en") {
        langCode = "en-US";
      } else if (sourceLanguage === "English") {
        langCode = "en-US";
      } else if (sourceLanguage === "Urdu") {
        langCode = "ur-PK";
      } else if (sourceLanguage !== "Auto Detect") {
        langCode = getLanguageCode(sourceLanguage);
      } else {
        // Auto Detect mode:
        langCode = targetLanguage === "Urdu" ? "en-US" : "ur-PK";
      }
      recognition.lang = langCode;

      recognition.onstart = () => {
        setIsListening(true);
        isListeningRef.current = true;
        setError(null);
      };

      recognition.onresult = (event: any) => {
        let interimTranscript = '';
        let finalTranscript = '';

        for (let i = 0; i < event.results.length; ++i) {
          const res = event.results[i];
          if (res.isFinal) {
            finalTranscript += res[0].transcript;
          } else {
            interimTranscript += res[0].transcript;
          }
        }

        const base = baseTextRef.current.trim();
        const spoken = (finalTranscript || interimTranscript).trim();
        if (spoken) {
          const combined = base ? `${base} ${spoken}` : spoken;
          setInputText(combined);
        }

        if (finalTranscript) {
          baseTextRef.current = base ? `${base} ${finalTranscript.trim()}` : finalTranscript.trim();
        }
      };

      recognition.onerror = (event: any) => {
        const err = event.error;
        if (err === 'aborted' || isStoppingRef.current) {
          return;
        }

        if (err === 'no-speech') {
          // Normal silence between sentences: auto-restart in onend
          return;
        }

        console.warn("Speech recognition notice:", err);
        setIsListening(false);
        isListeningRef.current = false;

        if (err === 'not-allowed' || err === 'service-not-allowed') {
          setError("مائیکروفون کی اجازت نہیں ملی۔ اگر براؤزر میں اجازت نہیں ہے تو نئی ٹیب میں کھول کر دیکھیں۔ (Microphone permission denied).");
        } else if (err === 'network') {
          setError("انٹرنیٹ کنکشن کا مسئلہ ہے۔ براہ کرم نیٹ ورک چیک کریں۔ (Network error in voice recognition).");
        } else if (err === 'audio-capture') {
          setError("مائیکروفون نہیں ملا یا مصروف ہے۔ براہ کرم چیک کریں۔ (No microphone detected or device is busy).");
        }
      };

      recognition.onend = () => {
        recognitionRef.current = null;
        if (isListeningRef.current && !isStoppingRef.current) {
          restartTimerRef.current = setTimeout(() => {
            if (isListeningRef.current && !isStoppingRef.current) {
              initRecognition();
            }
          }, 150);
        } else {
          setIsListening(false);
          isListeningRef.current = false;
        }
      };

      recognition.start();
      recognitionRef.current = recognition;
    } catch (err: any) {
      console.warn("Speech recognition start failed:", err);
      setIsListening(false);
      isListeningRef.current = false;
      setError("مائیکروفون شروع نہیں ہو سکا۔ براہ کرم دوبارہ کوشش کریں۔ (Could not start microphone).");
    }
  };

  const startListening = () => {
    setError(null);
    isStoppingRef.current = false;
    isListeningRef.current = true;
    stopSpeaking();
    baseTextRef.current = inputText;
    setIsListening(true);
    initRecognition();
  };

  const toggleListening = () => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  };

  const handleTranslate = async () => {
    if (!inputText.trim()) return;

    if (isListening) {
      stopListening();
    }
    stopSpeaking();

    setIsTranslating(true);
    setError(null);
    setOutputText("");
    
    try {
      let translationResult = "";
      let translated = false;

      // 1. Try server-side proxy endpoint first (available in AI Studio / Node environment)
      try {
        const response = await fetch('/api/translate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            text: inputText,
            sourceLanguage,
            targetLanguage
          })
        });

        const contentType = response.headers.get('content-type') || '';
        if (response.ok && contentType.includes('application/json')) {
          const data = await response.json();
          if (data && data.translation) {
            translationResult = data.translation;
            translated = true;
          }
        }
      } catch (serverErr) {
        console.warn("Server API not reachable (running on static host like GitHub Pages). Using client-side translator.", serverErr);
      }

      // 2. If server API not available (e.g. deployed to static GitHub Pages), translate client-side
      if (!translated) {
        translationResult = await translateClientSide(inputText, sourceLanguage, targetLanguage);
      }

      setOutputText(translationResult);
      if (translationResult && translationResult.trim()) {
        saveTranslationToHistory(inputText, translationResult, sourceLanguage, targetLanguage);
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during translation');
    } finally {
      setIsTranslating(false);
    }
  };

  const handleCopy = async () => {
    if (!outputText) return;
    try {
      await navigator.clipboard.writeText(outputText);
      const copyBtn = document.getElementById('copy-btn');
      if (copyBtn) {
        const originalText = copyBtn.innerText;
        copyBtn.innerText = "Copied!";
        setTimeout(() => {
          if (copyBtn) copyBtn.innerText = originalText;
        }, 2000);
      }
    } catch (err) {
      console.error('Failed to copy text', err);
    }
  };

  const stopSpeaking = () => {
    if (synthRef.current) {
      try {
        synthRef.current.cancel();
      } catch (e) {}
    }
    if (audioRef.current) {
      try {
        audioRef.current.pause();
        audioRef.current.currentTime = 0;
      } catch (e) {}
      audioRef.current = null;
    }
    setSpeakingTarget(null);
    activeUtteranceRef.current = null;
  };

  const speakText = async (text: string, language: string, target: 'input' | 'output') => {
    if (!text || !text.trim()) return;

    // If currently speaking this target, clicking again toggles it off
    if (speakingTarget === target) {
      stopSpeaking();
      return;
    }

    // Stop whatever is currently playing or recording
    stopSpeaking();
    if (isListening) {
      stopListening();
    }

    setSpeakingTarget(target);
    setError(null);

    const langCode = getLanguageCode(language);
    const shortLang = langCode.split('-')[0].toLowerCase();
    const synth = typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;

    // Helper 1: Play natural human voice audio via server TTS proxy
    const playAudioStream = (): Promise<boolean> => {
      return new Promise((resolve) => {
        try {
          const url = `/api/tts?text=${encodeURIComponent(text.trim())}&lang=${encodeURIComponent(shortLang)}`;
          const audio = new Audio();
          audioRef.current = audio;
          audio.src = url;

          audio.onended = () => {
            setSpeakingTarget(null);
            audioRef.current = null;
            resolve(true);
          };

          audio.onerror = (err) => {
            console.warn("Audio stream playback failed:", err);
            audioRef.current = null;
            resolve(false);
          };

          audio.play().then(() => {
            // Audio started playing successfully
          }).catch((err) => {
            console.warn("Audio play() blocked or error:", err);
            audioRef.current = null;
            resolve(false);
          });
        } catch (e) {
          resolve(false);
        }
      });
    };

    // Helper 2: Fallback to browser SpeechSynthesis
    const playSynth = (): boolean => {
      if (!synth) return false;
      try {
        synth.cancel();
        try { synth.resume(); } catch (e) {}

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.lang = langCode;
        utterance.rate = 0.95;
        utterance.pitch = 1.0;

        const optimalVoice = getOptimalVoice(langCode, synth);
        if (optimalVoice) {
          utterance.voice = optimalVoice;
        }

        utterance.onstart = () => {
          setSpeakingTarget(target);
        };

        utterance.onend = () => {
          setSpeakingTarget(null);
          activeUtteranceRef.current = null;
        };

        utterance.onerror = (e) => {
          setSpeakingTarget(null);
          activeUtteranceRef.current = null;
        };

        activeUtteranceRef.current = utterance;
        synth.speak(utterance);
        return true;
      } catch (err) {
        return false;
      }
    };

    // Try natural audio stream first (superior pronunciation for Urdu & other languages);
    // if that fails, fallback to browser speech synthesis.
    const streamed = await playAudioStream();
    if (!streamed) {
      const synthesized = playSynth();
      if (!synthesized) {
        setSpeakingTarget(null);
        setError("آواز نہیں چل سکی۔ براہ کرم انٹرنیٹ کنکشن چیک کریں۔ (Unable to play voice audio).");
      }
    }
  };

  const handleClear = () => {
    setInputText("");
    setOutputText("");
    setError(null);
    baseTextRef.current = "";
    if (isListening) {
      stopListening();
    }
    stopSpeaking();
  };

  const handleSelectRecent = (item: TranslationHistoryItem) => {
    setInputText(item.sourceText);
    setOutputText(item.translatedText);
    setSourceLanguage(item.sourceLanguage);
    setTargetLanguage(item.targetLanguage);
    setError(null);
  };

  return (
    <div className="w-full max-w-4xl mx-auto p-4 sm:p-6 md:p-8 font-sans">
      <header className="mb-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-center sm:text-left">
        <div>
          <h1 className="text-3xl font-bold text-gray-800 tracking-tight">AI Translator</h1>
          <p className="text-gray-500 mt-1">Translate text and voice instantly</p>
        </div>
        {onOpenHistory && (
          <button
            onClick={onOpenHistory}
            className="inline-flex items-center space-x-2 px-4 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 hover:text-blue-600 rounded-xl shadow-sm transition-all text-sm font-medium"
            title="Open Translation History Page"
          >
            <History className="w-4 h-4 text-blue-600" />
            <span>History</span>
            {recentHistory.length > 0 && (
              <span className="ml-1.5 px-2 py-0.5 text-xs font-semibold rounded-full bg-blue-100 text-blue-700">
                {recentHistory.length}
              </span>
            )}
          </button>
        )}
      </header>

      {/* Quick Recent Translations Bar */}
      {recentHistory.length > 0 && (
        <div className="mb-6 bg-white p-3 sm:p-4 rounded-xl border border-gray-200 shadow-sm">
          <div className="flex items-center justify-between mb-2.5">
            <div className="flex items-center space-x-1.5 text-xs font-semibold text-gray-600">
              <Clock className="w-3.5 h-3.5 text-blue-600" />
              <span>Recent Translations (Click to re-select):</span>
            </div>
            {onOpenHistory && (
              <button
                onClick={onOpenHistory}
                className="text-xs text-blue-600 hover:text-blue-800 hover:underline font-semibold"
              >
                View full history page →
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {recentHistory.map((item) => (
              <button
                key={item.id}
                onClick={() => handleSelectRecent(item)}
                className="group flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs bg-gray-50 hover:bg-blue-50 hover:border-blue-300 border border-gray-200 text-gray-700 hover:text-blue-700 transition-all text-left"
                title={`${item.sourceLanguage} → ${item.targetLanguage}: "${item.sourceText}"`}
              >
                <span className="font-bold text-gray-400 group-hover:text-blue-500">
                  {item.sourceLanguage.slice(0, 2).toUpperCase()}→{item.targetLanguage.slice(0, 2).toUpperCase()}:
                </span>
                <span className="truncate max-w-[120px] sm:max-w-[180px]">
                  {item.sourceText}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Language Selectors */}
      <div className="flex flex-col sm:flex-row items-center justify-between bg-white p-2 rounded-xl shadow-sm border border-gray-100 mb-6 gap-3 sm:gap-0">
        <select 
          value={sourceLanguage}
          onChange={(e) => setSourceLanguage(e.target.value)}
          className="w-full sm:w-[45%] bg-transparent p-3 text-lg font-medium text-gray-700 outline-none cursor-pointer appearance-none text-center sm:text-left border sm:border-none rounded-lg border-gray-200"
          aria-label="Source Language"
        >
          {LANGUAGES.map(lang => (
            <option key={lang} value={lang}>{lang}</option>
          ))}
        </select>

        <button 
          onClick={handleSwapLanguages}
          className="p-3 bg-gray-50 hover:bg-gray-100 text-gray-600 rounded-full transition-colors flex-shrink-0 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
          aria-label="Swap Languages"
          title="Swap Languages"
        >
          <ArrowRightLeft className="w-5 h-5" />
        </button>

        <select 
          value={targetLanguage}
          onChange={(e) => setTargetLanguage(e.target.value)}
          className="w-full sm:w-[45%] bg-transparent p-3 text-lg font-medium text-gray-700 outline-none cursor-pointer appearance-none text-center sm:text-right border sm:border-none rounded-lg border-gray-200"
          aria-label="Target Language"
        >
          {TARGET_LANGUAGES.map(lang => (
            <option key={lang} value={lang}>{lang}</option>
          ))}
        </select>
      </div>

      {error && (
        <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-xl border border-red-200 text-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div className="flex-1">{error}</div>
          {typeof window !== 'undefined' && window.self !== window.top && (
            <a
              href={window.location.href}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center px-3 py-1.5 bg-red-100 hover:bg-red-200 text-red-800 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors"
            >
              نئی ٹیب میں کھولیں (Open in New Tab)
              <ExternalLink className="w-3.5 h-3.5 ml-1.5" />
            </a>
          )}
        </div>
      )}

      {/* Input / Output Grids */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        
        {/* Source Text Area */}
        <div className="flex flex-col bg-white border border-gray-200 rounded-2xl shadow-sm overflow-hidden focus-within:ring-2 focus-within:ring-blue-500 focus-within:border-transparent transition-all">
          <textarea
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleTranslate();
              }
            }}
            dir="auto"
            placeholder="Type or speak to translate..."
            className="w-full h-48 lg:h-64 p-5 text-lg text-gray-800 resize-none outline-none placeholder-gray-400 bg-transparent"
            aria-label="Source text"
          />
          <div className="flex items-center justify-between p-3 bg-gray-50/50 border-t border-gray-100 flex-wrap gap-2">
            <div className="flex items-center space-x-2 flex-wrap gap-2">
              <button
                id="mic-btn"
                onClick={toggleListening}
                className={`px-3.5 py-2.5 rounded-full flex items-center justify-center transition-all duration-200 ${
                  isListening 
                    ? 'bg-red-500 text-white shadow-md shadow-red-200 animate-pulse ring-4 ring-red-100' 
                    : 'bg-white text-gray-700 hover:bg-gray-100 shadow-sm border border-gray-200'
                }`}
                aria-label={isListening ? "Stop listening" : "Start voice input"}
                title={isListening ? "Stop listening (ریکارڈنگ بند کریں)" : "Start voice input (بول کر لکھیں)"}
              >
                {isListening ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5 text-gray-600" />}
                {isListening ? (
                  <span className="ml-2 text-sm font-semibold tracking-wide flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-white animate-ping inline-block" />
                    Listening ({voiceLang === 'ur' ? 'اردو' : voiceLang === 'en' ? 'English' : 'Auto'})...
                  </span>
                ) : (
                  <span className="ml-1.5 text-xs text-gray-600 font-medium">بولیں (Voice)</span>
                )}
              </button>

              {/* Quick Microphone Language Switcher */}
              <div className="inline-flex items-center bg-gray-100 p-0.5 rounded-full border border-gray-200 text-xs font-medium">
                <button
                  type="button"
                  onClick={() => setVoiceLang('ur')}
                  className={`px-2.5 py-1 rounded-full transition-all ${voiceLang === 'ur' ? 'bg-white text-blue-600 shadow-xs font-semibold' : 'text-gray-600 hover:text-gray-900'}`}
                  title="Speak in Urdu"
                >
                  اردو
                </button>
                <button
                  type="button"
                  onClick={() => setVoiceLang('en')}
                  className={`px-2.5 py-1 rounded-full transition-all ${voiceLang === 'en' ? 'bg-white text-blue-600 shadow-xs font-semibold' : 'text-gray-600 hover:text-gray-900'}`}
                  title="Speak in English"
                >
                  English
                </button>
                <button
                  type="button"
                  onClick={() => setVoiceLang('auto')}
                  className={`px-2.5 py-1 rounded-full transition-all ${voiceLang === 'auto' ? 'bg-white text-blue-600 shadow-xs font-semibold' : 'text-gray-600 hover:text-gray-900'}`}
                  title="Auto detect language"
                >
                  خودکار
                </button>
              </div>

              <button
                id="speak-input-btn"
                onClick={() => {
                  const inputLang = sourceLanguage !== "Auto Detect" ? sourceLanguage : (targetLanguage === "Urdu" ? "English" : "Urdu");
                  speakText(inputText, inputLang, 'input');
                }}
                disabled={!inputText.trim()}
                className={`px-3 py-2.5 rounded-full flex items-center justify-center transition-all duration-200 ${
                  speakingTarget === 'input'
                    ? 'bg-blue-600 text-white shadow-md shadow-blue-200 animate-pulse ring-4 ring-blue-100'
                    : 'bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-900 shadow-sm border border-gray-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none'
                }`}
                aria-label={speakingTarget === 'input' ? "Stop speaking" : "Listen to input text"}
                title={speakingTarget === 'input' ? "Stop speaking (سننا بند کریں)" : "Listen to input text (سنیں)"}
              >
                {speakingTarget === 'input' ? (
                  <Square className="w-4 h-4 fill-current" />
                ) : (
                  <Volume2 className="w-4 h-4" />
                )}
                <span className="ml-1.5 text-xs font-medium">
                  {speakingTarget === 'input' ? "Speaking..." : "سنیں (Listen)"}
                </span>
              </button>
            </div>

            <button
              onClick={handleClear}
              disabled={!inputText && !outputText}
              className="p-3 text-gray-500 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Clear text"
              title="Clear (صاف کریں)"
            >
              <Trash2 className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Target Text Area */}
        <div className="flex flex-col bg-gray-50 border border-gray-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="w-full h-48 lg:h-64 p-5 text-lg text-gray-800 overflow-y-auto">
             {isTranslating ? (
                <div className="flex items-center space-x-3 text-blue-600 h-full">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="font-medium animate-pulse">Translating...</span>
                </div>
             ) : (
                outputText ? (
                  <p 
                    dir={["Urdu", "Arabic", "Persian"].includes(targetLanguage) ? "rtl" : "ltr"}
                    className="whitespace-pre-wrap leading-relaxed"
                  >
                    {outputText}
                  </p>
                ) : (
                  <p className="text-gray-400 italic">Translation will appear here...</p>
                )
             )}
          </div>
          <div className="flex items-center justify-end p-3 bg-gray-100/50 border-t border-gray-200 space-x-2">
            <button
              id="speak-btn"
              onClick={() => speakText(outputText, targetLanguage, 'output')}
              disabled={!outputText.trim()}
              className={`px-3.5 py-2.5 rounded-full flex items-center justify-center transition-all duration-200 ${
                speakingTarget === 'output' 
                  ? 'bg-blue-600 text-white shadow-md shadow-blue-200 animate-pulse ring-4 ring-blue-100' 
                  : 'bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-900 shadow-sm border border-gray-200 disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none'
              }`}
              aria-label={speakingTarget === 'output' ? "Stop speaking" : "Read translation aloud"}
              title={speakingTarget === 'output' ? "Stop speaking (سننا بند کریں)" : "Read translation aloud (ترجمہ سنیں)"}
            >
              {speakingTarget === 'output' ? (
                <Square className="w-4 h-4 fill-current" />
              ) : (
                <Volume2 className="w-4 h-4" />
              )}
              <span className="ml-1.5 text-xs font-medium">
                {speakingTarget === 'output' ? "Speaking..." : "ترجمہ سنیں (Listen)"}
              </span>
            </button>
            <button
              id="copy-btn"
              onClick={handleCopy}
              disabled={!outputText.trim()}
              className="px-4 py-2.5 bg-white text-gray-600 hover:bg-gray-100 hover:text-gray-900 border border-gray-200 rounded-full shadow-sm transition-colors flex items-center space-x-2 font-medium text-sm disabled:opacity-40 disabled:shadow-none disabled:cursor-not-allowed"
              aria-label="Copy translation"
            >
              <Copy className="w-4 h-4" />
              <span className="text-xs font-medium">Copy</span>
            </button>
          </div>
        </div>

      </div>

      {/* Translate Button Container */}
      <div className="flex justify-center mt-8">
        <button
          onClick={handleTranslate}
          disabled={!inputText.trim() || isTranslating}
          className="w-full sm:w-auto px-10 py-4 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-full shadow-lg hover:shadow-xl transition-all active:scale-95 disabled:opacity-70 disabled:active:scale-100 disabled:shadow-none flex items-center justify-center space-x-3 text-lg"
        >
          {isTranslating ? (
            <>
              <Loader2 className="w-6 h-6 animate-spin" />
              <span>Translating...</span>
            </>
          ) : (
            <span>Translate</span>
          )}
        </button>
      </div>

    </div>
  );
}
