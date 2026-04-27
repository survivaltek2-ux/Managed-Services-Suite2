import { Router, type Request } from "express";
import { db } from "@workspace/db";
import { conversations, messages, usersTable } from "@workspace/db";
import { and, count, eq, isNotNull } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";
import { rateLimit } from "express-rate-limit";

const router = Router();

// Per-user short-window rate limit — 20 messages per 15 minutes per verified user ID.
// Prevents burst abuse even from accounts that passed email verification.
const aiMessageLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  keyGenerator: (req: Request) => {
    const authReq = req as AuthRequest;
    return authReq.userId ? `user:${authReq.userId}` : req.ip ?? "unknown";
  },
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "too_many_requests", message: "AI message limit reached, please wait before sending more." },
});

// Per-user daily hard cap — 100 messages per 24 hours.
// Limits maximum AI spend per account regardless of burst rate.
const aiDailyLimiter = rateLimit({
  windowMs: 24 * 60 * 60 * 1000,
  limit: 100,
  keyGenerator: (req: Request) => {
    const authReq = req as AuthRequest;
    return authReq.userId ? `daily:${authReq.userId}` : req.ip ?? "unknown";
  },
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "daily_limit_reached", message: "Daily AI message limit reached. Please try again tomorrow." },
});

const MAX_CONVERSATIONS_PER_USER = 20;

const SYSTEM_PROMPT = `You are a helpful AI assistant for Siebert Services, a Managed Service Provider (MSP) that specializes in IT support, cloud services, cybersecurity, and unified communications (including being a certified Zoom partner).

Your role is to:
- Answer questions about Siebert Services' offerings: IT support, cloud services, cybersecurity, infrastructure management, and Zoom/unified communications
- Help visitors understand which services might be right for their business
- Guide users toward requesting a quote, scheduling a consultation, or contacting the team
- Answer general IT and technology questions in a friendly, professional manner

Keep responses concise, helpful, and professional. If a user has a complex or urgent technical issue, encourage them to submit a support ticket or call the team directly. Always be warm and approachable.`;

const MAX_MESSAGE_LENGTH = 4000;
const MAX_HISTORY_MESSAGES = 50;

router.get("/openai/conversations", requireAuth, async (req: AuthRequest, res) => {
  const result = await db
    .select()
    .from(conversations)
    .where(eq(conversations.userId, req.userId!))
    .orderBy(conversations.createdAt);
  res.json(result);
});

router.post("/openai/conversations", requireAuth, async (req: AuthRequest, res) => {
  const { title } = req.body;
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }

  // Enforce per-user conversation cap to prevent DB flooding.
  const [{ total }] = await db
    .select({ total: count() })
    .from(conversations)
    .where(eq(conversations.userId, req.userId!));
  if (total >= MAX_CONVERSATIONS_PER_USER) {
    res.status(429).json({
      error: "conversation_limit_reached",
      message: `You have reached the maximum of ${MAX_CONVERSATIONS_PER_USER} conversations. Please delete some before creating new ones.`,
    });
    return;
  }

  const [created] = await db
    .insert(conversations)
    .values({ title, userId: req.userId! })
    .returning();
  res.status(201).json(created);
});

router.get("/openai/conversations/:id", requireAuth, async (req: AuthRequest, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, req.userId!)));
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt);
  res.json({ ...conversation, messages: msgs });
});

router.delete("/openai/conversations/:id", requireAuth, async (req: AuthRequest, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const deleted = await db
    .delete(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, req.userId!)))
    .returning();
  if (!deleted.length) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }
  res.status(204).send();
});

router.get("/openai/conversations/:id/messages", requireAuth, async (req: AuthRequest, res) => {
  const id = parseInt(req.params.id as string);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, req.userId!)));
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  const msgs = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt);
  res.json(msgs);
});

router.post("/openai/conversations/:id/messages", requireAuth, aiMessageLimiter, aiDailyLimiter, async (req: AuthRequest, res) => {
  // Gate: user must have verified their email before using AI features
  const [callerUser] = await db
    .select({ emailVerifiedAt: usersTable.emailVerifiedAt })
    .from(usersTable)
    .where(and(eq(usersTable.id, req.userId!), isNotNull(usersTable.emailVerifiedAt)))
    .limit(1);
  if (!callerUser) {
    res.status(403).json({
      error: "email_not_verified",
      message: "Please verify your email address before using AI features.",
    });
    return;
  }

  const id = parseInt(req.params.id as string);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const { content } = req.body;
  if (!content) {
    res.status(400).json({ error: "content is required" });
    return;
  }

  if (typeof content !== "string" || content.length > MAX_MESSAGE_LENGTH) {
    res.status(400).json({ error: `Message content must be a string of at most ${MAX_MESSAGE_LENGTH} characters` });
    return;
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.id, id), eq(conversations.userId, req.userId!)));
  if (!conversation) {
    res.status(404).json({ error: "Conversation not found" });
    return;
  }

  await db.insert(messages).values({ conversationId: id, role: "user", content });

  const allHistory = await db
    .select()
    .from(messages)
    .where(eq(messages.conversationId, id))
    .orderBy(messages.createdAt);
  const history = allHistory.slice(-MAX_HISTORY_MESSAGES);

  const chatMessages = [
    { role: "system" as const, content: SYSTEM_PROMPT },
    ...history.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
  ];

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let fullResponse = "";

  const stream = await openai.chat.completions.create({
    model: "gpt-5.2",
    max_completion_tokens: 8192,
    messages: chatMessages,
    stream: true,
  });

  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) {
      fullResponse += text;
      res.write(`data: ${JSON.stringify({ content: text })}\n\n`);
    }
  }

  await db.insert(messages).values({ conversationId: id, role: "assistant", content: fullResponse });

  res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
  res.end();
});

export default router;
