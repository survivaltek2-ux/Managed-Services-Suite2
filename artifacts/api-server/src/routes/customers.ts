import { Router, type IRouter, type Response } from "express";
import { sql, desc, and, isNotNull, eq } from "drizzle-orm";
import { requireAdmin, type AuthRequest } from "../middlewares/auth.js";
import { db, documentsTable, writtenPlansTable } from "@workspace/db";

const router: IRouter = Router();

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");
}

router.get(
  "/admin/customers",
  requireAdmin,
  async (_req: AuthRequest, res: Response) => {
    try {
      const docRows = await db
        .select({
          name: documentsTable.customerCompany,
          docCount: sql<number>`count(*)::int`,
          lastDocAt: sql<Date | null>`max(${documentsTable.createdAt})`,
        })
        .from(documentsTable)
        .where(and(eq(documentsTable.active, true), isNotNull(documentsTable.customerCompany)))
        .groupBy(documentsTable.customerCompany);

      const planRows = await db
        .select({
          name: writtenPlansTable.clientCompany,
          planCount: sql<number>`count(*)::int`,
          lastPlanAt: sql<Date | null>`max(${writtenPlansTable.createdAt})`,
        })
        .from(writtenPlansTable)
        .where(isNotNull(writtenPlansTable.clientCompany))
        .groupBy(writtenPlansTable.clientCompany);

      const map = new Map<
        string,
        {
          displayName: string;
          docCount: number;
          planCount: number;
          lastActivityAt: Date | null;
        }
      >();

      for (const row of docRows) {
        if (!row.name) continue;
        const key = normalize(row.name);
        const existing = map.get(key);
        if (existing) {
          existing.docCount += Number(row.docCount) || 0;
          if (row.lastDocAt && (!existing.lastActivityAt || row.lastDocAt > existing.lastActivityAt)) {
            existing.lastActivityAt = row.lastDocAt;
          }
        } else {
          map.set(key, {
            displayName: row.name,
            docCount: Number(row.docCount) || 0,
            planCount: 0,
            lastActivityAt: row.lastDocAt,
          });
        }
      }

      for (const row of planRows) {
        if (!row.name) continue;
        const key = normalize(row.name);
        const existing = map.get(key);
        if (existing) {
          existing.planCount += Number(row.planCount) || 0;
          if (row.lastPlanAt && (!existing.lastActivityAt || row.lastPlanAt > existing.lastActivityAt)) {
            existing.lastActivityAt = row.lastPlanAt;
          }
        } else {
          map.set(key, {
            displayName: row.name,
            docCount: 0,
            planCount: Number(row.planCount) || 0,
            lastActivityAt: row.lastPlanAt,
          });
        }
      }

      const toMs = (v: Date | string | null | undefined): number => {
        if (!v) return 0;
        const d = v instanceof Date ? v : new Date(v);
        const t = d.getTime();
        return Number.isFinite(t) ? t : 0;
      };

      const customers = Array.from(map.entries())
        .map(([key, v]) => ({
          key,
          name: v.displayName,
          documentCount: v.docCount,
          planCount: v.planCount,
          totalCount: v.docCount + v.planCount,
          lastActivityAt: v.lastActivityAt,
        }))
        .sort((a, b) => toMs(b.lastActivityAt) - toMs(a.lastActivityAt));

      res.json({ customers });
    } catch (err) {
      console.error("[customers] list failed:", err);
      res.status(500).json({ error: "Failed to load customers" });
    }
  }
);

router.get(
  "/admin/customers/:key",
  requireAdmin,
  async (req: AuthRequest, res: Response) => {
    const key = String(req.params.key || "").toLowerCase();
    if (!key) return res.status(400).json({ error: "Missing customer key" });

    try {
      // Find every documentsTable / writtenPlansTable row whose normalized
      // company name matches `key`. Server-side normalization mirrors the
      // logic in normalize() above; we use SQL lower(trim()) for a basic
      // case+whitespace match and intersect with our key.
      const documents = await db
        .select({
          id: documentsTable.id,
          name: documentsTable.name,
          description: documentsTable.description,
          filename: documentsTable.filename,
          mimeType: documentsTable.mimeType,
          size: documentsTable.size,
          category: documentsTable.category,
          customerCompany: documentsTable.customerCompany,
          tags: documentsTable.tags,
          createdAt: documentsTable.createdAt,
        })
        .from(documentsTable)
        .where(
          and(
            eq(documentsTable.active, true),
            isNotNull(documentsTable.customerCompany),
            sql`lower(regexp_replace(regexp_replace(trim(${documentsTable.customerCompany}), '[.,]', '', 'g'), '\s+', ' ', 'g')) = ${key}`
          )
        )
        .orderBy(desc(documentsTable.createdAt));

      const plans = await db
        .select({
          id: writtenPlansTable.id,
          planNumber: writtenPlansTable.planNumber,
          version: writtenPlansTable.version,
          clientName: writtenPlansTable.clientName,
          clientCompany: writtenPlansTable.clientCompany,
          clientEmail: writtenPlansTable.clientEmail,
          status: writtenPlansTable.status,
          sentAt: writtenPlansTable.sentAt,
          approvedAt: writtenPlansTable.approvedAt,
          createdAt: writtenPlansTable.createdAt,
        })
        .from(writtenPlansTable)
        .where(
          and(
            isNotNull(writtenPlansTable.clientCompany),
            sql`lower(regexp_replace(regexp_replace(trim(${writtenPlansTable.clientCompany}), '[.,]', '', 'g'), '\s+', ' ', 'g')) = ${key}`
          )
        )
        .orderBy(desc(writtenPlansTable.createdAt));

      const displayName =
        documents[0]?.customerCompany || plans[0]?.clientCompany || key;

      res.json({ key, name: displayName, documents, plans });
    } catch (err) {
      console.error("[customers] detail failed:", err);
      res.status(500).json({ error: "Failed to load customer" });
    }
  }
);

export default router;
