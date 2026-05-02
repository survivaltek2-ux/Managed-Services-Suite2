import { Router, type IRouter } from "express";
import {
  db,
  marketplaceProductsTable,
  marketplaceVendorsTable,
  marketplaceOrdersTable,
  partnersTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth.js";

const router: IRouter = Router();

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function isMainAdmin(partnerId: number): Promise<boolean> {
  const rows = await db
    .select({ isAdmin: partnersTable.isAdmin })
    .from(partnersTable)
    .where(eq(partnersTable.id, partnerId))
    .limit(1);
  return rows.length > 0 && rows[0].isAdmin === true;
}

// ─── Public Routes ────────────────────────────────────────────────────────────

// GET /marketplace/vendors — all approved vendors
router.get("/vendors", async (_req, res) => {
  try {
    const vendors = await db
      .select()
      .from(marketplaceVendorsTable)
      .where(eq(marketplaceVendorsTable.status, "approved"))
      .orderBy(marketplaceVendorsTable.name);
    res.json({ vendors });
  } catch (error) {
    console.error("Error fetching vendors:", error);
    res.status(500).json({ error: "Failed to fetch vendors" });
  }
});

// GET /marketplace/products — active products with vendor name, optional ?category= filter
router.get("/products", async (req, res) => {
  try {
    const { category, vendorId } = req.query;

    const conditions = [
      eq(marketplaceProductsTable.status, "active"),
      eq(marketplaceVendorsTable.status, "approved"),
    ];
    if (category) {
      conditions.push(eq(marketplaceProductsTable.category, category as string));
    }
    if (vendorId) {
      const vid = parseInt(vendorId as string);
      if (!isNaN(vid)) conditions.push(eq(marketplaceProductsTable.vendorId, vid));
    }

    const products = await db
      .select({
        id: marketplaceProductsTable.id,
        vendorId: marketplaceProductsTable.vendorId,
        vendorName: marketplaceVendorsTable.name,
        title: marketplaceProductsTable.title,
        description: marketplaceProductsTable.description,
        category: marketplaceProductsTable.category,
        price: marketplaceProductsTable.price,
        commissionRate: marketplaceProductsTable.commissionRate,
        createdAt: marketplaceProductsTable.createdAt,
      })
      .from(marketplaceProductsTable)
      .innerJoin(
        marketplaceVendorsTable,
        eq(marketplaceProductsTable.vendorId, marketplaceVendorsTable.id)
      )
      .where(and(...conditions))
      .orderBy(marketplaceProductsTable.category, marketplaceProductsTable.title);

    res.json({ products });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// ─── Partner Routes ───────────────────────────────────────────────────────────

// GET /marketplace/partner/products — active products for authenticated partners (no vendor approval filter)
router.get("/partner/products", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { category } = req.query;

    const conditions: any[] = [eq(marketplaceProductsTable.status, "active")];
    if (category) {
      conditions.push(eq(marketplaceProductsTable.category, category as string));
    }

    const products = await db
      .select({
        id: marketplaceProductsTable.id,
        vendorId: marketplaceProductsTable.vendorId,
        vendorName: marketplaceVendorsTable.name,
        title: marketplaceProductsTable.title,
        description: marketplaceProductsTable.description,
        category: marketplaceProductsTable.category,
        price: marketplaceProductsTable.price,
        commissionRate: marketplaceProductsTable.commissionRate,
        createdAt: marketplaceProductsTable.createdAt,
      })
      .from(marketplaceProductsTable)
      .leftJoin(
        marketplaceVendorsTable,
        eq(marketplaceProductsTable.vendorId, marketplaceVendorsTable.id)
      )
      .where(and(...conditions))
      .orderBy(marketplaceProductsTable.category, marketplaceProductsTable.title);

    res.json({ products });
  } catch (error) {
    console.error("Error fetching partner products:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// POST /marketplace/orders — record a sale
router.post("/orders", requireAuth, async (req: AuthRequest, res) => {
  try {
    const { productId, amount, notes } = req.body;
    const partnerId = req.userId!;

    if (!productId || amount === undefined) {
      res.status(400).json({ error: "Missing required fields: productId, amount" });
      return;
    }

    const [product] = await db
      .select()
      .from(marketplaceProductsTable)
      .where(eq(marketplaceProductsTable.id, Number(productId)))
      .limit(1);

    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    const amountNum = parseFloat(amount);
    const commissionAmount = amountNum * (parseFloat(product.commissionRate) / 100);

    const [order] = await db
      .insert(marketplaceOrdersTable)
      .values({
        partnerId,
        productId: Number(productId),
        vendorId: product.vendorId,
        amount: amountNum.toFixed(2),
        commissionAmount: commissionAmount.toFixed(2),
        notes: notes || null,
      })
      .returning();

    res.status(201).json({ order });
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).json({ error: "Failed to create order" });
  }
});

// GET /marketplace/partner/orders — partner's own order history + summary
router.get("/partner/orders", requireAuth, async (req: AuthRequest, res) => {
  try {
    const partnerId = req.userId!;

    const orders = await db
      .select({
        id: marketplaceOrdersTable.id,
        productId: marketplaceOrdersTable.productId,
        vendorId: marketplaceOrdersTable.vendorId,
        status: marketplaceOrdersTable.status,
        amount: marketplaceOrdersTable.amount,
        commissionAmount: marketplaceOrdersTable.commissionAmount,
        notes: marketplaceOrdersTable.notes,
        createdAt: marketplaceOrdersTable.createdAt,
        productTitle: marketplaceProductsTable.title,
        vendorName: marketplaceVendorsTable.name,
      })
      .from(marketplaceOrdersTable)
      .innerJoin(
        marketplaceProductsTable,
        eq(marketplaceOrdersTable.productId, marketplaceProductsTable.id)
      )
      .innerJoin(
        marketplaceVendorsTable,
        eq(marketplaceOrdersTable.vendorId, marketplaceVendorsTable.id)
      )
      .where(eq(marketplaceOrdersTable.partnerId, partnerId))
      .orderBy(desc(marketplaceOrdersTable.createdAt));

    const totalCommissions = orders.reduce(
      (sum, o) => sum + parseFloat(o.commissionAmount),
      0
    );

    res.json({
      orders,
      summary: {
        totalOrders: orders.length,
        totalCommissions: totalCommissions.toFixed(2),
      },
    });
  } catch (error) {
    console.error("Error fetching partner orders:", error);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// ─── Admin Routes ─────────────────────────────────────────────────────────────

// GET /marketplace/admin/vendors — all vendors with product counts
router.get("/admin/vendors", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!(await isMainAdmin(req.userId!))) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const vendors = await db
      .select()
      .from(marketplaceVendorsTable)
      .orderBy(desc(marketplaceVendorsTable.createdAt));

    res.json({ vendors });
  } catch (error) {
    console.error("Error fetching vendors:", error);
    res.status(500).json({ error: "Failed to fetch vendors" });
  }
});

// POST /marketplace/admin/vendors — create vendor
router.post("/admin/vendors", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!(await isMainAdmin(req.userId!))) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const { name, description, contactEmail, website, commissionPercent, status } = req.body;
    if (!name || !contactEmail) {
      res.status(400).json({ error: "Missing required fields: name, contactEmail" });
      return;
    }

    const [vendor] = await db
      .insert(marketplaceVendorsTable)
      .values({
        name,
        description: description || null,
        contactEmail,
        website: website || null,
        commissionPercent: (commissionPercent || "15.00").toString(),
        status: status || "pending",
      })
      .returning();

    res.status(201).json({ vendor });
  } catch (error) {
    console.error("Error creating vendor:", error);
    res.status(500).json({ error: "Failed to create vendor" });
  }
});

// PATCH /marketplace/admin/vendors/:id — update vendor status or details
router.patch("/admin/vendors/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!(await isMainAdmin(req.userId!))) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const vendorId = parseInt(req.params.id as string);
    const { status, commissionPercent, name, description, website } = req.body;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (status) updates.status = status;
    if (commissionPercent !== undefined) updates.commissionPercent = commissionPercent.toString();
    if (name) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (website !== undefined) updates.website = website;

    const [vendor] = await db
      .update(marketplaceVendorsTable)
      .set(updates)
      .where(eq(marketplaceVendorsTable.id, vendorId))
      .returning();

    if (!vendor) {
      res.status(404).json({ error: "Vendor not found" });
      return;
    }

    res.json({ vendor });
  } catch (error) {
    console.error("Error updating vendor:", error);
    res.status(500).json({ error: "Failed to update vendor" });
  }
});

// GET /marketplace/admin/products — all products (admin)
router.get("/admin/products", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!(await isMainAdmin(req.userId!))) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const products = await db
      .select({
        id: marketplaceProductsTable.id,
        vendorId: marketplaceProductsTable.vendorId,
        vendorName: marketplaceVendorsTable.name,
        title: marketplaceProductsTable.title,
        description: marketplaceProductsTable.description,
        category: marketplaceProductsTable.category,
        price: marketplaceProductsTable.price,
        commissionRate: marketplaceProductsTable.commissionRate,
        status: marketplaceProductsTable.status,
        createdAt: marketplaceProductsTable.createdAt,
      })
      .from(marketplaceProductsTable)
      .innerJoin(
        marketplaceVendorsTable,
        eq(marketplaceProductsTable.vendorId, marketplaceVendorsTable.id)
      )
      .orderBy(marketplaceProductsTable.category, marketplaceProductsTable.title);

    res.json({ products });
  } catch (error) {
    console.error("Error fetching products:", error);
    res.status(500).json({ error: "Failed to fetch products" });
  }
});

// POST /marketplace/admin/products — create product
router.post("/admin/products", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!(await isMainAdmin(req.userId!))) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const { vendorId, title, description, category, price, commissionRate, status } = req.body;
    if (!vendorId || !title || !description || !category) {
      res.status(400).json({ error: "Missing required fields: vendorId, title, description, category" });
      return;
    }

    const [product] = await db
      .insert(marketplaceProductsTable)
      .values({
        vendorId: Number(vendorId),
        title,
        description,
        category,
        price: price ? price.toString() : null,
        commissionRate: (commissionRate || "15.00").toString(),
        status: status || "draft",
      })
      .returning();

    res.status(201).json({ product });
  } catch (error) {
    console.error("Error creating product:", error);
    res.status(500).json({ error: "Failed to create product" });
  }
});

// PATCH /marketplace/admin/products/:id — update product
router.patch("/admin/products/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!(await isMainAdmin(req.userId!))) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const productId = parseInt(req.params.id as string);
    const { title, description, category, price, commissionRate, status } = req.body;

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    if (title) updates.title = title;
    if (description) updates.description = description;
    if (category) updates.category = category;
    if (price !== undefined) updates.price = price ? price.toString() : null;
    if (commissionRate !== undefined) updates.commissionRate = commissionRate.toString();
    if (status) updates.status = status;

    const [product] = await db
      .update(marketplaceProductsTable)
      .set(updates)
      .where(eq(marketplaceProductsTable.id, productId))
      .returning();

    if (!product) {
      res.status(404).json({ error: "Product not found" });
      return;
    }

    res.json({ product });
  } catch (error) {
    console.error("Error updating product:", error);
    res.status(500).json({ error: "Failed to update product" });
  }
});

// GET /marketplace/admin/orders — all orders across all partners
router.get("/admin/orders", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!(await isMainAdmin(req.userId!))) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const orders = await db
      .select({
        id: marketplaceOrdersTable.id,
        partnerId: marketplaceOrdersTable.partnerId,
        partnerCompany: partnersTable.companyName,
        productId: marketplaceOrdersTable.productId,
        vendorId: marketplaceOrdersTable.vendorId,
        status: marketplaceOrdersTable.status,
        amount: marketplaceOrdersTable.amount,
        commissionAmount: marketplaceOrdersTable.commissionAmount,
        notes: marketplaceOrdersTable.notes,
        createdAt: marketplaceOrdersTable.createdAt,
        productTitle: marketplaceProductsTable.title,
        vendorName: marketplaceVendorsTable.name,
      })
      .from(marketplaceOrdersTable)
      .innerJoin(partnersTable, eq(marketplaceOrdersTable.partnerId, partnersTable.id))
      .innerJoin(
        marketplaceProductsTable,
        eq(marketplaceOrdersTable.productId, marketplaceProductsTable.id)
      )
      .innerJoin(
        marketplaceVendorsTable,
        eq(marketplaceOrdersTable.vendorId, marketplaceVendorsTable.id)
      )
      .orderBy(desc(marketplaceOrdersTable.createdAt));

    const totalRevenue = orders.reduce((sum, o) => sum + parseFloat(o.amount), 0);
    const totalCommissions = orders.reduce(
      (sum, o) => sum + parseFloat(o.commissionAmount),
      0
    );

    res.json({
      orders,
      summary: {
        totalOrders: orders.length,
        totalRevenue: totalRevenue.toFixed(2),
        totalCommissions: totalCommissions.toFixed(2),
      },
    });
  } catch (error) {
    console.error("Error fetching admin orders:", error);
    res.status(500).json({ error: "Failed to fetch orders" });
  }
});

// PATCH /marketplace/admin/orders/:id — update order status
router.patch("/admin/orders/:id", requireAuth, async (req: AuthRequest, res) => {
  try {
    if (!(await isMainAdmin(req.userId!))) {
      res.status(403).json({ error: "Admin access required" });
      return;
    }

    const orderId = parseInt(req.params.id as string);
    const { status } = req.body;

    const [order] = await db
      .update(marketplaceOrdersTable)
      .set({ status, updatedAt: new Date() })
      .where(eq(marketplaceOrdersTable.id, orderId))
      .returning();

    if (!order) {
      res.status(404).json({ error: "Order not found" });
      return;
    }

    res.json({ order });
  } catch (error) {
    console.error("Error updating order:", error);
    res.status(500).json({ error: "Failed to update order" });
  }
});

export default router;
