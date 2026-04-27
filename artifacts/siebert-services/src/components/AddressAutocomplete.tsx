import { useState, useRef, useEffect, useCallback } from "react";
import { MapPin, Loader2 } from "lucide-react";

export interface AddressResult {
  address: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
}

interface Prediction {
  place_id: string;
  description: string;
  main_text: string;
  secondary_text: string;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onAddressSelect: (result: AddressResult) => void;
  placeholder?: string;
}

// Generate a Google Places session token (UUID-ish). When the same token is
// sent on every autocomplete keystroke and the final details call, Google
// bills the entire interaction as a single "session" instead of charging per
// request. Reset after each successful selection so the next address starts
// a new session.
function newSessionToken(): string {
  const c = (typeof globalThis !== "undefined" ? globalThis.crypto : undefined) as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}

export function AddressAutocomplete({ value, onChange, onAddressSelect, placeholder = "Street address" }: Props) {
  const [suggestions, setSuggestions] = useState<Prediction[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const suggestionsRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionTokenRef = useRef<string | null>(null);

  const fetchSuggestions = useCallback(async (input: string) => {
    if (!input.trim() || input.trim().length < 3) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    if (!sessionTokenRef.current) sessionTokenRef.current = newSessionToken();
    const token = sessionTokenRef.current;

    setLoading(true);
    try {
      const res = await fetch(`/api/places/autocomplete?input=${encodeURIComponent(input)}&sessiontoken=${encodeURIComponent(token)}`);
      const data = await res.json();
      if (data.predictions && data.predictions.length > 0) {
        setSuggestions(data.predictions);
        setShowSuggestions(true);
      } else {
        setSuggestions([]);
        setShowSuggestions(false);
      }
    } catch {
      setSuggestions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      fetchSuggestions(value);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [value, fetchSuggestions]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        !inputRef.current?.contains(e.target as Node) &&
        !suggestionsRef.current?.contains(e.target as Node)
      ) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = async (prediction: Prediction) => {
    onChange(prediction.main_text);
    setShowSuggestions(false);
    setSuggestions([]);

    const token = sessionTokenRef.current;
    // Reset for the next address so Google starts a fresh session.
    sessionTokenRef.current = null;

    try {
      const url = token
        ? `/api/places/details?place_id=${encodeURIComponent(prediction.place_id)}&sessiontoken=${encodeURIComponent(token)}`
        : `/api/places/details?place_id=${encodeURIComponent(prediction.place_id)}`;
      const res = await fetch(url);
      const data = await res.json();
      if (!data.error) {
        onAddressSelect({
          address: data.address || prediction.main_text,
          city: data.city || "",
          state: data.state || "",
          zip: data.zip || "",
          lat: data.lat,
          lng: data.lng,
        });
      }
    } catch {
      // If details fail, at least use the prediction text
      onAddressSelect({ address: prediction.main_text, city: "", state: "", zip: "", lat: null, lng: null });
    }
  };

  return (
    <div className="relative">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
          placeholder={placeholder}
          autoComplete="off"
          className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#0176d3]"
        />
        {loading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-gray-500" />
          </div>
        )}
      </div>

      {showSuggestions && suggestions.length > 0 && (
        <div
          ref={suggestionsRef}
          className="absolute top-full left-0 right-0 mt-1 bg-white border border-gray-300 rounded-md shadow-lg z-50 max-h-64 overflow-y-auto"
        >
          {suggestions.map(s => (
            <button
              key={s.place_id}
              type="button"
              onClick={() => handleSelect(s)}
              className="w-full text-left px-3 py-2.5 hover:bg-gray-50 flex items-start gap-2 border-b border-gray-200 last:border-b-0 transition-colors"
            >
              <MapPin className="w-3.5 h-3.5 text-gray-500 shrink-0 mt-0.5" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-900 truncate">{s.main_text}</p>
                <p className="text-xs text-gray-600 truncate">{s.secondary_text}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
