import React, { useState, useEffect } from 'react';
import { Clock, ArrowRight, Copy, Check, Trash2, ArrowLeft, Languages } from 'lucide-react';
import { TranslationHistoryItem } from '../types';
import { getTranslationHistory, clearTranslationHistory, deleteTranslationFromHistory } from '../utils/historyStorage';

interface HistoryPageProps {
  onSelectTranslation: (item: TranslationHistoryItem) => void;
  onNavigateToTranslator: () => void;
}

export default function HistoryPage({
  onSelectTranslation,
  onNavigateToTranslator
}: HistoryPageProps) {
  const [history, setHistory] = useState<TranslationHistoryItem[]>([]);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadHistory = () => {
    setHistory(getTranslationHistory());
  };

  useEffect(() => {
    loadHistory();

    const handleStorageChange = () => {
      loadHistory();
    };

    window.addEventListener('translation-history-changed', handleStorageChange);
    window.addEventListener('storage', handleStorageChange);

    return () => {
      window.removeEventListener('translation-history-changed', handleStorageChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) {
      console.error('Failed to copy text:', err);
    }
  };

  const handleDelete = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    deleteTranslationFromHistory(id);
    loadHistory();
  };

  const handleClearAll = () => {
    if (window.confirm('Are you sure you want to clear all translation history?')) {
      clearTranslationHistory();
      setHistory([]);
    }
  };

  const formatTime = (timestamp: number) => {
    try {
      const diffMs = Date.now() - timestamp;
      const diffSec = Math.floor(diffMs / 1000);
      const diffMin = Math.floor(diffSec / 60);
      const diffHr = Math.floor(diffMin / 60);

      if (diffSec < 60) return 'Just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      if (diffHr < 24) return `${diffHr}h ago`;
      return new Date(timestamp).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      });
    } catch {
      return '';
    }
  };

  const isRTL = (lang: string) => ['Urdu', 'Arabic', 'Persian'].includes(lang);

  return (
    <div className="w-full max-w-4xl mx-auto p-4 sm:p-6 md:p-8 font-sans">
      {/* Top Bar / Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-gray-200">
        <div className="flex items-center space-x-3">
          <button
            onClick={onNavigateToTranslator}
            className="p-2 rounded-lg text-gray-600 hover:text-gray-900 hover:bg-gray-100 transition-colors flex items-center gap-1.5 text-sm font-medium"
            title="Back to Translator"
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="hidden sm:inline">Back</span>
          </button>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 tracking-tight flex items-center gap-2">
              <Clock className="w-7 h-7 text-blue-600" />
              Translation History
            </h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Saved last 5 translations in your browser
            </p>
          </div>
        </div>

        {history.length > 0 && (
          <button
            onClick={handleClearAll}
            className="flex items-center space-x-1.5 text-xs sm:text-sm text-red-600 hover:text-red-700 hover:bg-red-50 py-2 px-3 rounded-lg font-medium transition-colors border border-red-200"
            title="Clear all saved translations"
          >
            <Trash2 className="w-4 h-4" />
            <span>Clear All</span>
          </button>
        )}
      </div>

      {/* History Items List */}
      {history.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-200 p-10 sm:p-14 text-center shadow-sm">
          <div className="w-16 h-16 bg-blue-50 text-blue-600 rounded-full flex items-center justify-center mx-auto mb-4">
            <Clock className="w-8 h-8" />
          </div>
          <h3 className="text-xl font-semibold text-gray-800 mb-2">No Saved Translations</h3>
          <p className="text-gray-500 text-sm max-w-md mx-auto mb-6">
            When you translate text in the app, your last 5 translations will automatically be preserved here so you can quickly re-use them anytime.
          </p>
          <button
            onClick={onNavigateToTranslator}
            className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-full shadow-md hover:shadow-lg transition-all"
          >
            <Languages className="w-4 h-4" />
            <span>Go to Translator</span>
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between text-xs text-gray-400 font-medium px-1">
            <span>Showing {history.length} of 5 recent translations</span>
            <span>Click any item or "Use in Translator" to reload</span>
          </div>

          {history.map((item, index) => (
            <div
              key={item.id}
              onClick={() => onSelectTranslation(item)}
              className="group bg-white rounded-2xl border border-gray-200 hover:border-blue-300 hover:shadow-md transition-all p-5 sm:p-6 cursor-pointer relative"
            >
              {/* Card Header: Languages and Timestamp */}
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3 pb-3 border-b border-gray-100">
                <div className="flex items-center space-x-2">
                  <span className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center">
                    {index + 1}
                  </span>
                  <div className="flex items-center space-x-1.5 text-xs sm:text-sm font-semibold text-gray-700 bg-gray-50 px-2.5 py-1 rounded-md border border-gray-200">
                    <span>{item.sourceLanguage}</span>
                    <ArrowRight className="w-3.5 h-3.5 text-gray-400" />
                    <span className="text-blue-600">{item.targetLanguage}</span>
                  </div>
                </div>

                <div className="flex items-center space-x-3 text-xs text-gray-400">
                  <span>{formatTime(item.timestamp)}</span>
                  <button
                    onClick={(e) => handleDelete(item.id, e)}
                    className="p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                    title="Delete this record"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Card Body: Source & Target */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 my-2">
                {/* Source Text */}
                <div className="bg-gray-50/70 p-3.5 rounded-xl border border-gray-100">
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-gray-400 block mb-1">
                    Original ({item.sourceLanguage})
                  </span>
                  <p
                    dir={isRTL(item.sourceLanguage) ? 'rtl' : 'ltr'}
                    className="text-gray-800 text-sm sm:text-base leading-relaxed line-clamp-4"
                  >
                    {item.sourceText}
                  </p>
                </div>

                {/* Target Translation */}
                <div className="bg-blue-50/40 p-3.5 rounded-xl border border-blue-100/60">
                  <span className="text-[11px] uppercase tracking-wider font-semibold text-blue-500 block mb-1">
                    Translation ({item.targetLanguage})
                  </span>
                  <p
                    dir={isRTL(item.targetLanguage) ? 'rtl' : 'ltr'}
                    className="text-gray-900 font-medium text-sm sm:text-base leading-relaxed line-clamp-4"
                  >
                    {item.translatedText}
                  </p>
                </div>
              </div>

              {/* Card Footer: Action Buttons */}
              <div className="flex items-center justify-end space-x-2 pt-3 mt-2 border-t border-gray-100">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopy(item.id, item.translatedText);
                  }}
                  className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 bg-gray-50 hover:bg-gray-100 border border-gray-200 transition-colors flex items-center space-x-1.5"
                  title="Copy translation"
                >
                  {copiedId === item.id ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-green-600" />
                      <span className="text-green-600">Copied!</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-gray-500" />
                      <span>Copy</span>
                    </>
                  )}
                </button>

                <button
                  onClick={() => onSelectTranslation(item)}
                  className="px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 shadow-sm transition-colors flex items-center space-x-1.5"
                >
                  <span>Use in Translator</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
