import React, { useState, useEffect, useRef } from "react";
import { PortalLayout } from "@/components/layout/PortalLayout";
import { useAuth, getAuthHeaders } from "@/hooks/use-auth";
import { Link } from "wouter";
import { ArrowLeft, Wand2, Save, RotateCcw, ChevronDown, CheckCircle, Loader2, AlertCircle, Sparkles, MessageSquare, FileText } from "lucide-react";
import AdminAIAssistant from "./AdminAIAssistant";

const BASE = import.meta.env.BASE_URL;

const PAGES_CONFIG: Record<string, { label: string; sections: Record<string, { label: string; description: string; multiline?: boolean }> }> = {
  home: {
    label: "Home Page",
    sections: {
      heroTitle: { label: "Hero Title", description: "Main headline on the homepage" },
      heroSubtitle: { label: "Hero Subtitle", description: "Subheading below the main title" },
      heroDescription: { label: "Hero Description", description: "Short description paragraph in the hero" },
      ispSectionTitle: { label: "ISP Section Title", description: "Headline for the internet plans section" },
      ispSectionDesc: { label: "ISP Section Description", description: "Description for the internet plans section" },
    },
  },
  "comcast-business": {
    label: "Comcast Business",
    sections: {
      heroTitle: { label: "Hero Title", description: "Page headline" },
      heroSubtitle: { label: "Hero Subtitle", description: "Subheading above the title" },
      heroDescription: { label: "Hero Description", description: "Lead paragraph below the title", multiline: true },
    },
  },
  "spectrum-business": {
    label: "Spectrum Business",
    sections: {
      heroTitle: { label: "Hero Title", description: "Page headline" },
      heroSubtitle: { label: "Hero Subtitle", description: "Subheading above the title" },
      heroDescription: { label: "Hero Description", description: "Lead paragraph below the title", multiline: true },
    },
  },
  "att-business": {
    label: "AT&T Business",
    sections: {
      heroTitle: { label: "Hero Title", description: "Page headline" },
      heroSubtitle: { label: "Hero Subtitle", description: "Subheading above the title" },
      heroDescription: { label: "Hero Description", description: "Lead paragraph below the title", multiline: true },
    },
  },
  "verizon-business": {
    label: "Verizon Business",
    sections: {
      heroTitle: { label: "Hero Title", description: "Page headline" },
      heroSubtitle: { label: "Hero Subtitle", description: "Subheading above the title" },
      heroDescription: { label: "Hero Description", description: "Lead paragraph below the title", multiline: true },
    },
  },
  "cox-business": {
    label: "Cox Business",
    sections: {
      heroTitle: { label: "Hero Title", description: "Page headline" },
      heroSubtitle: { label: "Hero Subtitle", description: "Subheading above the title" },
      heroDescription: { label: "Hero Description", description: "Lead paragraph below the title", multiline: true },
    },
  },
  ringcentral: {
    label: "RingCentral",
    sections: {
      heroTitle: { label: "Hero Title", description: "Page headline" },
      heroSubtitle: { label: "Hero Subtitle", description: "Subheading above the title" },
      heroDescription: { label: "Hero Description", description: "Lead paragraph below the title", multiline: true },
    },
  },
  "microsoft-365": {
    label: "Microsoft 365",
    sections: {
      heroTitle: { label: "Hero Title", description: "Page headline" },
      heroSubtitle: { label: "Hero Subtitle", description: "Subheading above the title" },
      heroDescription: { label: "Hero Description", description: "Lead paragraph below the title", multiline: true },
    },
  },
  "8x8": {
    label: "8x8",
    sections: {
      heroTitle: { label: "Hero Title", description: "Page headline" },
      heroSubtitle: { label: "Hero Subtitle", description: "Subheading above the title" },
      heroDescription: { label: "Hero Description", description: "Lead paragraph below the title", multiline: true },
    },
  },
  "t-mobile-business": {
    label: "T-Mobile for Business",
    sections: {
      heroTitle: { label: "Hero Title", description: "Page headline" },
      heroSubtitle: { label: "Hero Subtitle", description: "Subheading above the title" },
      heroDescription: { label: "Hero Description", description: "Lead paragraph below the title", multiline: true },
    },
  },
  lumen: {
    label: "Lumen Technologies",
    sections: {
      heroTitle: { label: "Hero Title", description: "Page headline" },
      heroSubtitle: { label: "Hero Subtitle", description: "Subheading above the title" },
      heroDescription: { label: "Hero Description", description: "Lead paragraph below the title", multiline: true },
    },
  },
  "cisco-meraki": {
    label: "Cisco Meraki",
    sections: {
      heroTitle: { label: "Hero Title", description: "Page headline" },
      heroSubtitle: { label: "Hero Subtitle", description: "Subheading above the title" },
      heroDescription: { label: "Hero Description", description: "Lead paragraph below the title", multiline: true },
    },
  },
  fortinet: {
    label: "Fortinet",
    sections: {
      heroTitle: { label: "Hero Title", description: "Page headline" },
      heroSubtitle: { label: "Hero Subtitle", description: "Subheading above the title" },
      heroDescription: { label: "Hero Description", description: "Lead paragraph below the title", multiline: true },
    },
  },
  "adt-business": {
    label: "ADT Business",
    sections: {
      heroTitle: { label: "Hero Title", description: "Page headline" },
      heroSubtitle: { label: "Hero Subtitle", description: "Subheading above the title" },
      heroDescription: { label: "Hero Description", description: "Lead paragraph below the title", multiline: true },
    },
  },
  "palo-alto-networks": {
    label: "Palo Alto Networks",
    sections: {
      heroTitle: { label: "Hero Title", description: "Page headline" },
      heroSubtitle: { label: "Hero Subtitle", description: "Subheading above the title" },
      heroDescription: { label: "Hero Description", description: "Lead paragraph below the title", multiline: true },
    },
  },
  altice: {
    label: "Altice / Optimum",
    sections: {
      heroTitle: { label: "Hero Title", description: "Page headline" },
      heroSubtitle: { label: "Hero Subtitle", description: "Subheading above the title" },
      heroDescription: { label: "Hero Description", description: "Lead paragraph below the title", multiline: true },
    },
  },
  dell: {
    label: "Dell Technologies",
    sections: {
      heroSubtitle: { label: "Partner Badge", description: "Badge text above the headline (e.g. 'Dell Technologies Partner')" },
      heroTitle: { label: "Hero Title", description: "Main headline (first line of the large h1)" },
      heroAccent: { label: "Hero Accent", description: "Colored second line of the large h1" },
      heroDescription: { label: "Hero Description", description: "Paragraph below the headline", multiline: true },
    },
  },
  hp: {
    label: "HP Solutions",
    sections: {
      heroSubtitle: { label: "Partner Badge", description: "Badge text above the headline" },
      heroTitle: { label: "Hero Title", description: "Main headline (first line of the large h1)" },
      heroAccent: { label: "Hero Accent", description: "Colored second line of the large h1" },
      heroDescription: { label: "Hero Description", description: "Paragraph below the headline", multiline: true },
    },
  },
  "extreme-networks": {
    label: "Extreme Networks",
    sections: {
      heroSubtitle: { label: "Partner Badge", description: "Badge text above the headline" },
      heroTitle: { label: "Hero Title", description: "Main headline (first line of the large h1)" },
      heroAccent: { label: "Hero Accent", description: "Colored second line of the large h1" },
      heroDescription: { label: "Hero Description", description: "Paragraph below the headline", multiline: true },
    },
  },
  "juniper-networks": {
    label: "Juniper Networks",
    sections: {
      heroSubtitle: { label: "Partner Badge", description: "Badge text above the headline" },
      heroTitle: { label: "Hero Title", description: "Main headline (first line of the large h1)" },
      heroAccent: { label: "Hero Accent", description: "Colored second line of the large h1" },
      heroDescription: { label: "Hero Description", description: "Paragraph below the headline", multiline: true },
    },
  },
  vivint: {
    label: "Vivint Smart Home",
    sections: {
      heroTitle: { label: "Hero Title", description: "Page headline" },
      heroSubtitle: { label: "Hero Subtitle", description: "Tagline displayed below the title" },
      heroDescription: { label: "Hero Description", description: "Lead paragraph below the title", multiline: true },
    },
  },
  "zoom-partner": {
    label: "Zoom Partner",
    sections: {
      heroBadge: { label: "Partner Badge", description: "Badge text (e.g. 'Official Certified Partner')" },
      heroTitle: { label: "Hero Title", description: "Main headline" },
      heroDescription: { label: "Hero Description", description: "Paragraph below the headline", multiline: true },
    },
  },
};

type Mode = "page-editor" | "ai-assistant";

export default function AIPageEditor() {
  const { user } = useAuth();
  const [mode, setMode] = useState<Mode>("ai-assistant");
  const [selectedSlug, setSelectedSlug] = useState<string>("home");
  const [content, setContent] = useState<Record<string, string>>({});
  const [editedContent, setEditedContent] = useState<Record<string, string>>({});
  const [aiRequest, setAiRequest] = useState("");
  const [aiStreaming, setAiStreaming] = useState(false);
  const [aiSuggestions, setAiSuggestions] = useState<Record<string, string> | null>(null);
  const [aiRaw, setAiRaw] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [loadingContent, setLoadingContent] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const aiInputRef = useRef<HTMLTextAreaElement>(null);

  const pageConfig = PAGES_CONFIG[selectedSlug];

  useEffect(() => {
    setLoadingContent(true);
    setAiSuggestions(null);
    setAiRaw("");
    setAiError(null);
    fetch(`${BASE}api/page-content/${selectedSlug}`)
      .then((r) => (r.ok ? r.json() : {}))
      .then((data: Record<string, string>) => {
        setContent(data);
        setEditedContent(data);
      })
      .catch(() => {
        setContent({});
        setEditedContent({});
      })
      .finally(() => setLoadingContent(false));
  }, [selectedSlug]);

  if (!user?.isAdmin) {
    return (
      <PortalLayout>
        <div className="p-8 text-center text-red-600">Access denied. Admin only.</div>
      </PortalLayout>
    );
  }

  const handleAiSuggest = async () => {
    if (!aiRequest.trim()) return;
    setAiStreaming(true);
    setAiSuggestions(null);
    setAiRaw("");
    setAiError(null);

    const allPagesPayload = Object.entries(PAGES_CONFIG).map(([slug, cfg]) => ({
      slug,
      label: cfg.label,
      sections: cfg.sections,
    }));

    try {
      const res = await fetch(`${BASE}api/page-content/ai-suggest`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify({
          allPages: allPagesPayload,
          userRequest: aiRequest,
        }),
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error("No stream");

      let buffer = "";
      let accumulated = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += new TextDecoder().decode(value);
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let json: { content?: string; done?: boolean; fullResponse?: string; error?: string };
          try {
            json = JSON.parse(line.slice(6));
          } catch {
            continue;
          }
          if (json.error) {
            setAiError(json.error);
            continue;
          }
          if (json.content) accumulated += json.content;
          if (json.done) {
            const raw = (json.fullResponse || accumulated).trim();
            setAiRaw(raw);
            if (!raw) {
              setAiError("AI returned an empty response. Try again.");
              continue;
            }
            const cleaned = raw.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
            let parsed: unknown;
            try {
              parsed = JSON.parse(cleaned);
            } catch {
              setAiError("AI returned an unexpected format (not valid JSON). Try again.");
              continue;
            }
            if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
              setAiError("AI returned an unexpected format. Try again.");
              continue;
            }
            const { targetSlug, ...suggestions } = parsed as { targetSlug?: string } & Record<string, string>;
            if (targetSlug && PAGES_CONFIG[targetSlug]) {
              setSelectedSlug(targetSlug);
            }
            const suggestionKeys = Object.keys(suggestions);
            if (suggestionKeys.length === 0) {
              setAiError("AI didn't suggest any changes. Try rephrasing your request.");
              continue;
            }
            setAiSuggestions(suggestions);
          }
        }
      }
    } catch {
      setAiError("Failed to get AI suggestions. Please try again.");
    } finally {
      setAiStreaming(false);
    }
  };

  const handleApplySuggestion = (key: string, value: string) => {
    setEditedContent((prev) => ({ ...prev, [key]: value }));
    setAiSuggestions((prev) => {
      if (!prev) return prev;
      const next = { ...prev };
      delete next[key];
      return Object.keys(next).length === 0 ? null : next;
    });
  };

  const handleApplyAll = () => {
    if (!aiSuggestions) return;
    setEditedContent((prev) => ({ ...prev, ...aiSuggestions }));
    setAiSuggestions(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(false);
    try {
      const res = await fetch(`${BASE}api/page-content/${selectedSlug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...getAuthHeaders() },
        body: JSON.stringify(editedContent),
      });
      if (!res.ok) throw new Error("Save failed");
      setContent(editedContent);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch {
      alert("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const hasChanges = JSON.stringify(content) !== JSON.stringify(editedContent);

  return (
    <PortalLayout>
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center gap-3 mb-6">
          <Link href="/admin/inquiries">
            <a className="text-gray-500 hover:text-gray-700">
              <ArrowLeft className="w-5 h-5" />
            </a>
          </Link>
          <div className="flex-1">
            <h1 className="text-2xl font-bold text-[#032d60] flex items-center gap-2">
              <Sparkles className="w-6 h-6 text-purple-600" />
              AI Admin Tools
            </h1>
            <p className="text-sm text-gray-500 mt-0.5">Manage your business and edit pages using AI</p>
          </div>
          {/* Mode tabs */}
          <div className="flex items-center bg-gray-100 rounded-lg p-1 gap-1">
            <button
              onClick={() => setMode("ai-assistant")}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition ${
                mode === "ai-assistant" ? "bg-white shadow text-purple-700" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <MessageSquare className="w-4 h-4" />
              AI Assistant
            </button>
            <button
              onClick={() => setMode("page-editor")}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-md text-sm font-medium transition ${
                mode === "page-editor" ? "bg-white shadow text-purple-700" : "text-gray-500 hover:text-gray-700"
              }`}
            >
              <FileText className="w-4 h-4" />
              Page Editor
            </button>
          </div>
        </div>

        {/* AI Assistant Mode */}
        {mode === "ai-assistant" && (
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden" style={{ height: "70vh" }}>
            <AdminAIAssistant />
          </div>
        )}

        {/* Page Editor Mode */}
        {mode === "page-editor" && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left: AI chat */}
          <div className="lg:col-span-1 space-y-4">
            {/* AI Chat */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Wand2 className="w-4 h-4 text-purple-600" />
                <h2 className="text-sm font-semibold text-gray-700">AI Content Assistant</h2>
              </div>
              <p className="text-xs text-gray-500 mb-3">
                Describe what you want to change — mention the page by name and the AI will find it automatically.
              </p>
              <textarea
                ref={aiInputRef}
                value={aiRequest}
                onChange={(e) => setAiRequest(e.target.value)}
                placeholder={`e.g. "Update the AT&T Business hero title to focus on fiber speed" or "Make the RingCentral description more exciting and mention 24/7 support"`}
                rows={6}
                className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                onKeyDown={(e) => {
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleAiSuggest();
                }}
              />
              <button
                onClick={handleAiSuggest}
                disabled={aiStreaming || !aiRequest.trim()}
                className="mt-2 w-full flex items-center justify-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-300 text-white text-sm font-semibold py-2 px-4 rounded-md transition"
              >
                {aiStreaming ? (
                  <><Loader2 className="w-4 h-4 animate-spin" /> Generating...</>
                ) : (
                  <><Wand2 className="w-4 h-4" /> Generate Suggestions</>
                )}
              </button>
              <p className="text-xs text-gray-400 mt-1.5 text-center">⌘ + Enter to submit</p>
            </div>

            {/* AI Suggestions */}
            {aiError && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                <div className="flex items-center gap-2 text-red-700">
                  <AlertCircle className="w-4 h-4" />
                  <p className="text-sm">{aiError}</p>
                </div>
              </div>
            )}

            {aiSuggestions && Object.keys(aiSuggestions).length > 0 && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-purple-800 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4" />
                    AI Suggestions
                  </h3>
                  <button
                    onClick={handleApplyAll}
                    className="text-xs bg-purple-600 text-white px-3 py-1 rounded-full font-medium hover:bg-purple-700 transition"
                  >
                    Apply All
                  </button>
                </div>
                <div className="space-y-3">
                  {Object.entries(aiSuggestions).map(([key, value]) => {
                    const sectionLabel = pageConfig?.sections[key]?.label ?? key;
                    return (
                      <div key={key} className="bg-white border border-purple-200 rounded p-3">
                        <p className="text-xs font-medium text-purple-700 mb-1">{sectionLabel}</p>
                        <p className="text-xs text-gray-700 leading-relaxed">{value}</p>
                        <button
                          onClick={() => handleApplySuggestion(key, value)}
                          className="mt-2 text-xs text-purple-600 hover:text-purple-800 font-medium"
                        >
                          ✓ Apply this suggestion
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Right: Content editor */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-lg border border-gray-200">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-gray-400 whitespace-nowrap">Viewing:</span>
                  <div className="relative">
                    <select
                      value={selectedSlug}
                      onChange={(e) => setSelectedSlug(e.target.value)}
                      className="border border-gray-300 rounded-md pl-2 pr-7 py-1 text-sm font-semibold text-[#032d60] appearance-none focus:outline-none focus:ring-2 focus:ring-purple-500 bg-white"
                    >
                      {Object.entries(PAGES_CONFIG).map(([slug, cfg]) => (
                        <option key={slug} value={slug}>{cfg.label}</option>
                      ))}
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2 top-1.5 pointer-events-none" />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {hasChanges && (
                    <button
                      onClick={() => setEditedContent(content)}
                      className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 px-3 py-1.5 rounded border border-gray-300 hover:bg-gray-50 transition"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      Reset
                    </button>
                  )}
                  <button
                    onClick={handleSave}
                    disabled={saving || !hasChanges}
                    className="flex items-center gap-1.5 text-sm bg-[#032d60] hover:bg-[#032d60]/90 disabled:bg-gray-300 text-white px-4 py-1.5 rounded transition font-medium"
                  >
                    {saving ? (
                      <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving...</>
                    ) : saveSuccess ? (
                      <><CheckCircle className="w-3.5 h-3.5" /> Saved!</>
                    ) : (
                      <><Save className="w-3.5 h-3.5" /> Save Changes</>
                    )}
                  </button>
                </div>
              </div>

              {loadingContent ? (
                <div className="p-8 text-center">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-purple-600 mb-2" />
                  <p className="text-sm text-gray-500">Loading content...</p>
                </div>
              ) : (
                <div className="p-5 space-y-5">
                  {pageConfig && Object.entries(pageConfig.sections).map(([key, cfg]) => {
                    const current = editedContent[key] ?? "";
                    const original = content[key] ?? "";
                    const hasThisChange = current !== original && original !== "";
                    const isNew = current !== "" && original === "";
                    return (
                      <div key={key}>
                        <div className="flex items-center justify-between mb-1">
                          <label className="block text-sm font-semibold text-gray-700">
                            {cfg.label}
                            {(hasThisChange || isNew) && (
                              <span className="ml-2 text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">Modified</span>
                            )}
                          </label>
                          {aiSuggestions?.[key] && (
                            <span className="text-xs text-purple-600 font-medium animate-pulse">AI suggestion available ↙</span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mb-1.5">{cfg.description}</p>
                        {cfg.multiline ? (
                          <textarea
                            value={current}
                            onChange={(e) => setEditedContent((prev) => ({ ...prev, [key]: e.target.value }))}
                            rows={3}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-purple-500"
                            placeholder={`Enter ${cfg.label.toLowerCase()}...`}
                          />
                        ) : (
                          <input
                            type="text"
                            value={current}
                            onChange={(e) => setEditedContent((prev) => ({ ...prev, [key]: e.target.value }))}
                            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                            placeholder={`Enter ${cfg.label.toLowerCase()}...`}
                          />
                        )}
                        {hasThisChange && (
                          <p className="text-xs text-gray-400 mt-1 truncate">
                            Original: <span className="italic">{original || "(empty)"}</span>
                          </p>
                        )}
                      </div>
                    );
                  })}

                  {!pageConfig && (
                    <p className="text-sm text-gray-500 text-center py-6">No editable sections configured for this page.</p>
                  )}
                </div>
              )}
            </div>

            {/* Info box */}
            <div className="mt-4 bg-blue-50 border border-blue-200 rounded-lg p-4">
              <h3 className="text-sm font-semibold text-blue-800 mb-1">How it works</h3>
              <ul className="text-xs text-blue-700 space-y-1 list-disc list-inside">
                <li>Just describe what you want — mention the page name and the AI finds the right page automatically</li>
                <li>Changes saved here override the default text on the live website immediately</li>
                <li>Fields left blank use the page's built-in default text</li>
                <li>Review AI suggestions and apply individual ones or all at once, then hit Save</li>
                <li>Use the "Viewing" dropdown to manually browse or edit any page at any time</li>
              </ul>
            </div>
          </div>
        </div>
        )}
      </div>
    </PortalLayout>
  );
}
