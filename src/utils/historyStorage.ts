import { TranslationHistoryItem } from '../types';

const STORAGE_KEY = 'translation_history_v1';
const MAX_HISTORY_ITEMS = 5;

export function getTranslationHistory(): TranslationHistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.slice(0, MAX_HISTORY_ITEMS);
    }
  } catch (err) {
    console.warn('Failed to parse translation history from localStorage:', err);
  }
  return [];
}

export function saveTranslationToHistory(
  sourceText: string,
  translatedText: string,
  sourceLanguage: string,
  targetLanguage: string
): TranslationHistoryItem[] {
  if (typeof window === 'undefined') return [];
  if (!sourceText.trim() || !translatedText.trim()) return getTranslationHistory();

  try {
    const current = getTranslationHistory();
    // Filter out duplicates with the exact same input text and target language
    const filtered = current.filter(
      item => !(item.sourceText.trim().toLowerCase() === sourceText.trim().toLowerCase() && 
                item.targetLanguage === targetLanguage)
    );

    const newItem: TranslationHistoryItem = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
      sourceText: sourceText.trim(),
      translatedText: translatedText.trim(),
      sourceLanguage,
      targetLanguage,
      timestamp: Date.now()
    };

    const updated = [newItem, ...filtered].slice(0, MAX_HISTORY_ITEMS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('translation-history-changed'));
    return updated;
  } catch (err) {
    console.warn('Failed to save translation history to localStorage:', err);
    return getTranslationHistory();
  }
}

export function deleteTranslationFromHistory(id: string): TranslationHistoryItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const current = getTranslationHistory();
    const updated = current.filter(item => item.id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('translation-history-changed'));
    return updated;
  } catch (err) {
    console.warn('Failed to delete translation item:', err);
    return getTranslationHistory();
  }
}

export function clearTranslationHistory(): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.removeItem(STORAGE_KEY);
    window.dispatchEvent(new CustomEvent('translation-history-changed'));
  } catch (err) {
    console.warn('Failed to clear translation history:', err);
  }
}
