import { Router } from "express";
import { db } from "@workspace/db";
import { pageSectionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { requireAuth, requireAdmin } from "../middlewares/auth";
import { openai, AI_MODEL } from "@workspace/integrations-openai-ai-server";

const router = Router();

router.get("/page-content/:slug", async (req, res) => {
  try {
    const slug = req.params.slug as string;
    const sections = await db
      .select()
      .from(pageSectionsTable)
      .where(eq(pageSectionsTable.pageSlug, slug));

    const contentMap: Record<string, string> = {};
    for (const s of sections) {
      contentMap[s.sectionKey] = s.content;
    }
    res.json(contentMap);
  } catch (err) {
    console.error("GET /page-content/:slug error:", err);
    res.status(500).json({ error: "Failed to fetch page content" });
  }
});

router.put("/page-content/:slug/:key", requireAuth, requireAdmin, async (req, res) => {
  try {
    const slug = req.params.slug as string;
    const key = req.params.key as string;
    const { content } = req.body;

    if (!content || typeof content !== "string") {
      res.status(400).json({ error: "content is required" });
      return;
    }

    const existing = await db
      .select()
      .from(pageSectionsTable)
      .where(and(eq(pageSectionsTable.pageSlug, slug), eq(pageSectionsTable.sectionKey, key)));

    if (existing.length > 0) {
      await db
        .update(pageSectionsTable)
        .set({ content, updatedAt: new Date() })
        .where(and(eq(pageSectionsTable.pageSlug, slug), eq(pageSectionsTable.sectionKey, key)));
    } else {
      await db.insert(pageSectionsTable).values({ pageSlug: slug, sectionKey: key, content });
    }

    res.json({ success: true });
  } catch (err) {
    console.error("PUT /page-content/:slug/:key error:", err);
    res.status(500).json({ error: "Failed to update page content" });
  }
});

router.put("/page-content/:slug", requireAuth, requireAdmin, async (req, res) => {
  try {
    const slug = req.params.slug as string;
    const updates: Record<string, string> = req.body;

    if (!updates || typeof updates !== "object") {
      res.status(400).json({ error: "Body must be a key-value object" });
      return;
    }

    for (const [key, content] of Object.entries(updates)) {
      const existing = await db
        .select()
        .from(pageSectionsTable)
        .where(and(eq(pageSectionsTable.pageSlug, slug), eq(pageSectionsTable.sectionKey, key)));

      if (existing.length > 0) {
        await db
          .update(pageSectionsTable)
          .set({ content, updatedAt: new Date() })
          .where(and(eq(pageSectionsTable.pageSlug, slug), eq(pageSectionsTable.sectionKey, key)));
      } else {
        await db.insert(pageSectionsTable).values({ pageSlug: slug, sectionKey: key, content });
      }
    }

    res.json({ success: true });
  } catch (err) {
    console.error("PUT /page-content/:slug error:", err);
    res.status(500).json({ error: "Failed to update page content" });
  }
});

router.post("/page-content/ai-suggest", requireAuth, requireAdmin, async (req, res) => {
  try {
    const { pageSlug, pageName, currentContent, userRequest, allPages } = req.body;

    if (!userRequest) {
      res.status(400).json({ error: "userRequest is required" });
      return;
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    const isGlobal = !pageSlug && Array.isArray(allPages) && allPages.length > 0;

    let systemPrompt: string;
    let userMessage: string;

    if (isGlobal) {
      // Fetch current content for all pages from the DB
      const allContent: Record<string, Record<string, string>> = {};
      for (const pg of allPages as Array<{ slug: string; label: string; sections: Record<string, { label: string; description: string }> }>) {
        const sections = await db
          .select()
          .from(pageSectionsTable)
          .where(eq(pageSectionsTable.pageSlug, pg.slug));
        allContent[pg.slug] = {};
        for (const s of sections) {
          allContent[pg.slug][s.sectionKey] = s.content;
        }
      }

      const pageList = (allPages as Array<{ slug: string; label: string; sections: Record<string, { label: string }> }>)
        .map(pg => {
          const fields = Object.entries(pg.sections).map(([k, v]) => `  - ${k}: ${v.label}`).join("\n");
          const current = allContent[pg.slug] ?? {};
          const currentFields = Object.entries(current).map(([k, v]) => `  ${k}: "${v}"`).join("\n");
          return `Page: "${pg.label}" (slug: ${pg.slug})\nEditable fields:\n${fields}\nCurrent content:\n${currentFields || "  (all defaults — nothing saved yet)"}`;
        })
        .join("\n\n---\n\n");

      systemPrompt = `You are an expert copywriter and web content editor for Siebert Services, a professional B2B MSP and technology reseller.

You help the admin update text on any of the vendor/service pages on their website. The admin will describe what they want changed in plain English — you must figure out which page they are referring to and what to change.

Tone: professional, B2B-focused, benefit-driven, concise.

You must respond with ONLY valid JSON — no markdown, no explanation. The JSON must include a "targetSlug" field (the slug of the page being edited) plus any content fields that should change.

Example response:
{
  "targetSlug": "att-business",
  "heroTitle": "Updated Title Here",
  "heroDescription": "Updated description."
}

Only include fields that should change. If a field should stay the same, omit it. Always include targetSlug.`;

      userMessage = `${pageList}

---

Admin request: ${userRequest}

Identify the correct page from the request, then return ONLY the JSON object with "targetSlug" and any updated content fields.`;

    } else {
      systemPrompt = `You are an expert copywriter and web content editor for Siebert Services, a professional B2B Managed Service Provider (MSP) and technology reseller.

You help the admin update the text content of vendor/service pages on their website. When given current page content and a request for changes, you respond ONLY with a JSON object containing the updated content fields.

The tone should be:
- Professional and confident
- B2B focused (targeting business decision-makers)
- Clear and concise
- Benefit-focused (what does the customer get?)

You must respond with ONLY valid JSON. No markdown, no explanation, no preamble. Just the JSON object with the updated content fields that need to change.

Example response format:
{
  "heroTitle": "Updated Title Here",
  "heroSubtitle": "Updated subtitle text here"
}

Only include fields that should change based on the user's request. If a field should stay the same, omit it from your response.`;

      userMessage = `Page: ${pageName} (slug: ${pageSlug})

Current content:
${JSON.stringify(currentContent, null, 2)}

Admin request: ${userRequest}

Return ONLY the JSON object with updated content fields.`;
    }

    let fullResponse = "";

    const stream = await openai.chat.completions.create({
      model: AI_MODEL,
      max_completion_tokens: 8192,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      stream: true,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content;
      if (content) {
        fullResponse += content;
        res.write(`data: ${JSON.stringify({ content })}\n\n`);
      }
    }

    res.write(`data: ${JSON.stringify({ done: true, fullResponse })}\n\n`);
    res.end();
  } catch (err) {
    console.error("POST /page-content/ai-suggest error:", err);
    const reason = describeAiError(err);
    res.write(`data: ${JSON.stringify({ error: `AI suggestion failed: ${reason}` })}\n\n`);
    res.end();
  }
});

function describeAiError(err: unknown): string {
  const e = err as { status?: number; code?: string; message?: string };
  if (e?.status === 401 || e?.status === 403) return "AI service authentication failed";
  if (e?.status === 404 || e?.code === "model_not_found") return "model unavailable";
  if (e?.status === 429) return "rate limited by AI service";
  if (e?.status === 408 || e?.code === "ETIMEDOUT") return "AI service timed out";
  if (e?.status && e.status >= 500) return "AI service unavailable";
  if (typeof e?.message === "string" && e.message) return e.message.slice(0, 140);
  return "unknown error";
}

export default router;
