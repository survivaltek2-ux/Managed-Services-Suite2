import { useState, useRef, useEffect } from "react";
import { Wand2, Send, Loader2, User, Bot, ChevronDown, ChevronUp, RotateCcw, Zap } from "lucide-react";
function getAdminAuthHeaders() {
  const token = localStorage.getItem("token") || localStorage.getItem("partner_token");
  return token ? { Authorization: `Bearer ${token}` } : {};
}


interface ToolCall {
  name: string;
  args: Record<string, unknown>;
  result?: unknown;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
}

const TOOL_LABELS: Record<string, string> = {
  get_stats: "Fetching dashboard stats",
  get_partners: "Looking up partners",
  update_partner: "Updating partner",
  get_leads: "Looking up leads",
  update_lead: "Updating lead",
  get_deals: "Looking up deals",
  get_commissions: "Looking up commissions",
  update_commission: "Updating commission",
  get_invoices: "Looking up invoices",
  get_contacts: "Looking up contacts",
  get_marketplace: "Fetching marketplace data",
  get_page_content: "Reading page content",
  update_page_content: "Updating page content",
};

const QUICK_ACTIONS = [
  { label: "Dashboard overview", prompt: "Give me a dashboard overview of the business right now." },
  { label: "Pending approvals", prompt: "What partners and commissions are waiting for approval?" },
  { label: "New leads", prompt: "Show me all new leads." },
  { label: "Recent contacts", prompt: "Show me the latest contact form submissions." },
  { label: "Unpaid commissions", prompt: "List all pending commissions that need to be approved." },
  { label: "Open invoices", prompt: "Show me all invoices that haven't been paid yet." },
];

function ToolCallBadge({ call, expanded, onToggle }: { call: ToolCall; expanded: boolean; onToggle: () => void }) {
  const label = TOOL_LABELS[call.name] ?? call.name.replace(/_/g, " ");
  const isDone = call.result !== undefined;
  const isUpdate = call.name.startsWith("update_");

  return (
    <div className="my-1.5">
      <button
        onClick={onToggle}
        className={`flex items-center gap-2 text-xs px-3 py-1.5 rounded-full border transition w-full text-left ${
          isDone
            ? isUpdate
              ? "bg-green-50 border-green-200 text-green-700"
              : "bg-blue-50 border-blue-200 text-blue-700"
            : "bg-yellow-50 border-yellow-200 text-yellow-700"
        }`}
      >
        {isDone ? (
          <span className="w-3.5 h-3.5 rounded-full bg-current opacity-60 flex-shrink-0 flex items-center justify-center text-white" style={{ fontSize: 8 }}>✓</span>
        ) : (
          <Loader2 className="w-3.5 h-3.5 animate-spin flex-shrink-0" />
        )}
        <span className="flex-1 font-medium">{isDone ? `${label} — done` : `${label}…`}</span>
        {isDone && (expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />)}
      </button>
      {expanded && isDone && (
        <div className="mt-1 ml-2 bg-gray-50 border border-gray-200 rounded-lg p-3 text-xs text-gray-600 overflow-auto max-h-64">
          <pre className="whitespace-pre-wrap break-words font-mono text-[10px]">{JSON.stringify(call.result, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}

function AssistantMessage({ msg }: { msg: Message }) {
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());

  const toggleTool = (i: number) => {
    setExpandedTools(prev => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i); else next.add(i);
      return next;
    });
  };

  return (
    <div className="flex gap-3">
      <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center flex-shrink-0 mt-0.5">
        <Bot className="w-4 h-4 text-purple-600" />
      </div>
      <div className="flex-1 min-w-0">
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <div className="mb-2">
            {msg.toolCalls.map((call, i) => (
              <ToolCallBadge
                key={i}
                call={call}
                expanded={expandedTools.has(i)}
                onToggle={() => toggleTool(i)}
              />
            ))}
          </div>
        )}
        {msg.content && (
          <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3 text-sm text-gray-800 leading-relaxed whitespace-pre-wrap">
            {msg.content}
            {msg.isStreaming && <span className="inline-block w-1.5 h-4 bg-purple-500 ml-1 animate-pulse rounded-sm" />}
          </div>
        )}
        {!msg.content && msg.isStreaming && (
          <div className="bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-4 py-3">
            <Loader2 className="w-4 h-4 animate-spin text-purple-400" />
          </div>
        )}
      </div>
    </div>
  );
}

export default function AdminAIAssistant() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (text: string) => {
    if (!text.trim() || isLoading) return;

    const userMsg: Message = { id: Date.now().toString(), role: "user", content: text.trim() };
    const assistantId = (Date.now() + 1).toString();
    const assistantMsg: Message = { id: assistantId, role: "assistant", content: "", toolCalls: [], isStreaming: true };

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setInput("");
    setIsLoading(true);

    const history = [...messages, userMsg].map(m => ({ role: m.role, content: m.content }));
    const currentToolCalls: ToolCall[] = [];

    try {
      const res = await fetch(`/api/admin/ai-assistant`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getAdminAuthHeaders() },
        body: JSON.stringify({ messages: history }),
      });

      if (!res.ok || !res.body) throw new Error("Request failed");

      const reader = res.body.getReader();
      let buffer = "";
      let accText = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += new TextDecoder().decode(value);
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          let evt: Record<string, unknown>;
          try { evt = JSON.parse(line.slice(6)); } catch { continue; }

          if (evt.type === "tool_call") {
            const call: ToolCall = { name: evt.name as string, args: evt.args as Record<string, unknown> };
            currentToolCalls.push(call);
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, toolCalls: [...currentToolCalls] } : m));
          } else if (evt.type === "tool_result") {
            const idx = currentToolCalls.findLastIndex(c => c.name === evt.name && c.result === undefined);
            if (idx >= 0) currentToolCalls[idx].result = evt.result;
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, toolCalls: [...currentToolCalls] } : m));
          } else if (evt.type === "content") {
            accText += evt.text as string;
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: accText } : m));
          } else if (evt.type === "done") {
            const finalText = (evt.fullText as string) || accText;
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: finalText, toolCalls: [...currentToolCalls], isStreaming: false } : m));
          } else if (evt.type === "error") {
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: `Error: ${evt.message}`, isStreaming: false } : m));
          }
        }
      }
    } catch {
      setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, content: "Something went wrong. Please try again.", isStreaming: false } : m));
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  const clearChat = () => setMessages([]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-full bg-purple-100 flex items-center justify-center">
            <Bot className="w-4 h-4 text-purple-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-gray-800">AI Admin Assistant</p>
            <p className="text-xs text-gray-400">Ask anything · Takes actions · Edits pages</p>
          </div>
        </div>
        {messages.length > 0 && (
          <button
            onClick={clearChat}
            className="flex items-center gap-1.5 text-xs text-gray-400 hover:text-gray-600 transition px-2 py-1 rounded hover:bg-gray-100"
          >
            <RotateCcw className="w-3 h-3" /> Clear
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <div className="w-14 h-14 rounded-full bg-purple-50 flex items-center justify-center mx-auto mb-4">
              <Wand2 className="w-7 h-7 text-purple-500" />
            </div>
            <h3 className="text-sm font-semibold text-gray-700 mb-1">What do you need?</h3>
            <p className="text-xs text-gray-400 mb-6 max-w-xs mx-auto">
              Ask me to look up data, approve records, update partners, manage commissions, or edit any page content.
            </p>
            <div className="grid grid-cols-2 gap-2 max-w-sm mx-auto">
              {QUICK_ACTIONS.map(qa => (
                <button
                  key={qa.label}
                  onClick={() => sendMessage(qa.prompt)}
                  className="flex items-center gap-1.5 text-left text-xs bg-white border border-gray-200 hover:border-purple-300 hover:bg-purple-50 text-gray-700 px-3 py-2 rounded-lg transition"
                >
                  <Zap className="w-3 h-3 text-purple-400 flex-shrink-0" />
                  {qa.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map(msg => (
          <div key={msg.id}>
            {msg.role === "user" ? (
              <div className="flex gap-3 justify-end">
                <div className="max-w-[80%] bg-[#032d60] text-white rounded-2xl rounded-tr-sm px-4 py-2.5 text-sm">
                  {msg.content}
                </div>
                <div className="w-7 h-7 rounded-full bg-gray-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <User className="w-4 h-4 text-gray-500" />
                </div>
              </div>
            ) : (
              <AssistantMessage msg={msg} />
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-gray-200 bg-white">
        <div className="flex gap-2 items-end">
          <textarea
            ref={inputRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask anything — look up data, approve records, edit pages…"
            rows={2}
            disabled={isLoading}
            className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <button
            onClick={() => sendMessage(input)}
            disabled={isLoading || !input.trim()}
            className="flex items-center justify-center w-10 h-10 rounded-xl bg-purple-600 hover:bg-purple-700 disabled:bg-gray-200 text-white transition flex-shrink-0"
          >
            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1.5">Enter to send · Shift+Enter for new line</p>
      </div>
    </div>
  );
}
