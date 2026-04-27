import { openai, AI_MODEL } from "@workspace/integrations-openai-ai-server";
console.log("Testing model:", AI_MODEL);
try {
  const resp = await openai.chat.completions.create({
    model: AI_MODEL,
    messages: [
      { role: "system", content: "You are a helpful assistant. Reply with just one word." },
      { role: "user", content: "Say hi." },
    ],
    stream: false,
  });
  console.log("OK chat.completions.create:", resp.choices?.[0]?.message?.content?.slice(0, 200));
} catch (e) {
  console.error("FAIL chat.completions.create:", e?.status, e?.code, e?.message?.slice(0, 300));
}

try {
  const stream = await openai.chat.completions.create({
    model: AI_MODEL,
    max_completion_tokens: 100,
    messages: [
      { role: "system", content: "Reply with one word JSON only: {\"ok\":true}" },
      { role: "user", content: "go" },
    ],
    stream: true,
  });
  let full = "";
  for await (const chunk of stream) {
    const t = chunk.choices[0]?.delta?.content;
    if (t) full += t;
  }
  console.log("OK stream:", full.slice(0, 200));
} catch (e) {
  console.error("FAIL stream:", e?.status, e?.code, e?.message?.slice(0, 300));
}
