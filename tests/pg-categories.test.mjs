/**
 * Product categories — a real tree (0062).
 *
 * `products.category` was plain text while Mongo carried a taxonomy the
 * categories screens render. Four things Mongo maintained by hand are database
 * rules now, and the tests that matter are the ones proving each.
 *
 * Skipped unless DATABASE_URL is set.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";

const DATABASE_URL = process.env.DATABASE_URL;
const ADMIN_URL = process.env.DIRECT_DATABASE_URL || DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const repo = await import("@/app/db/repositories/categories");

suite("product categories", () => {
  let admin, client, db, companyId, userId;

  const asTenant = (fn) =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT set_config('app.company_id', ${companyId}, true)`);
      return fn(tx);
    });

  const mk = (name, parentId = null, extra = {}) =>
    asTenant((tx) =>
      repo.createCategory(tx, {
        companyId,
        name,
        parentId,
        createdById: userId,
        ...extra,
      }),
    );

  const addProduct = (categoryId, sku = "SKU-" + randomUUID().slice(0, 6)) =>
    asTenant((tx) =>
      tx.execute(sql`
        INSERT INTO products (company_id, sku, name, category_id)
        VALUES (${companyId}::uuid, ${sku}, 'A product', ${categoryId}::uuid)`),
    );

  beforeAll(async () => {
    admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
    client = postgres(process.env.PG_TEST_URL ?? DATABASE_URL, { max: 1, onnotice: () => {} });
    db = drizzle(client);
  });
  afterAll(async () => {
    if (client) await client.end();
    if (admin) await admin.end();
  });

  beforeEach(async () => {
    await admin`TRUNCATE companies CASCADE`;
    companyId = randomUUID();
    userId = randomUUID();
    await admin`INSERT INTO companies (id, name, slug)
      VALUES (${companyId}, 'Acme', ${"a-" + companyId.slice(0, 8)})`;
    await admin`INSERT INTO users (id, home_company_id, name, email, role)
      VALUES (${userId}, ${companyId}, 'Ann', ${userId + "@x.test"}, 'Admin')`;
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the tree", () => {
    it("levels a category from its position, not from a stored number", async () => {
      const electronics = await mk("Electronics");
      const scales = await mk("Scales", electronics.id);
      const platform = await mk("Platform", scales.id);

      const found = await asTenant((tx) => repo.getCategory(tx, platform.id));
      expect(found.level).toBe(2);
      expect(found.path).toBe("Electronics > Scales > Platform");
    });

    it("MOVES THE DESCENDANTS when a category is re-parented", async () => {
      // The Mongo pre-save hook recomputes the path of the row being saved and
      // leaves every child pointing through a parent that has moved. This is
      // the test that caught `AFTER UPDATE OF path` never firing.
      const electronics = await mk("Electronics");
      const scales = await mk("Scales", electronics.id);
      const platform = await mk("Platform", scales.id);

      await asTenant((tx) =>
        repo.updateCategory(tx, scales.id, { parentId: null }),
      );

      const found = await asTenant((tx) => repo.getCategory(tx, platform.id));
      expect(found.level).toBe(1);
      expect(found.path).toBe("Scales > Platform");
    });

    it("refuses to move a category beneath itself", async () => {
      const { userMessage } = await import("@/app/db/errors");
      const parent = await mk("Tools");
      const child = await mk("Spanners", parent.id);

      let caught;
      try {
        await asTenant((tx) =>
          repo.updateCategory(tx, parent.id, { parentId: child.id }),
        );
      } catch (err) {
        caught = err;
      }

      expect(caught).toBeDefined();
      // Asserted through userMessage because that is what a person sees: a
      // RAISE EXCEPTION lands on the cause, and drizzle's wrapper message is
      // the statement. Same trap as the petty cash overlap constraint.
      expect(userMessage(caught)).toMatch(/beneath itself/i);
    });

    it("refuses two siblings with the same name — including two roots", async () => {
      await mk("Electronics");
      // The Mongo index was (companyId, name, parent); NULL parents never
      // collide in a btree, so two ROOTS could share a name.
      await expect(mk("Electronics")).rejects.toThrow();

      const a = await mk("Tools");
      await mk("Hammers", a.id);
      await expect(mk("Hammers", a.id)).rejects.toThrow();
    });

    it("allows the same name under DIFFERENT parents", async () => {
      const a = await mk("Electronics");
      const b = await mk("Tools");
      await mk("Accessories", a.id);
      const second = await mk("Accessories", b.id);
      expect(second.id).toBeTruthy();
    });

    it("nests the tree in one pass, parents before children", async () => {
      const electronics = await mk("Electronics");
      const scales = await mk("Scales", electronics.id);
      await mk("Platform", scales.id);
      await mk("Tools");

      const tree = await asTenant((tx) => repo.getCategoryTree(tx));
      expect(tree).toHaveLength(2); // two roots
      const el = tree.find((t) => t.name === "Electronics");
      expect(el.children).toHaveLength(1);
      expect(el.children[0].children[0].name).toBe("Platform");
    });

    it("returns a whole subtree from one indexed query", async () => {
      const electronics = await mk("Electronics");
      const scales = await mk("Scales", electronics.id);
      await mk("Platform", scales.id);
      await mk("Tools");

      const subtree = await asTenant((tx) => repo.listSubtree(tx, electronics.id));
      expect(subtree.map((c) => c.name)).toEqual([
        "Electronics",
        "Scales",
        "Platform",
      ]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("deletion", () => {
    it("refuses a category that still has products", async () => {
      // Mongo decided this on a CACHED productCount. Drift low and the
      // category goes with its products still pointing at it.
      const cat = await mk("Electronics");
      await addProduct(cat.id);
      await expect(
        asTenant((tx) => repo.deleteCategory(tx, cat.id)),
      ).rejects.toThrow(/1 product/);
    });

    it("refuses a category that still has children", async () => {
      const parent = await mk("Tools");
      await mk("Spanners", parent.id);
      await expect(
        asTenant((tx) => repo.deleteCategory(tx, parent.id)),
      ).rejects.toThrow(/sub-categor/);
    });

    it("deletes a leaf with nothing filed under it", async () => {
      const cat = await mk("Obsolete");
      const gone = await asTenant((tx) => repo.deleteCategory(tx, cat.id));
      expect(gone.name).toBe("Obsolete");
    });

    it("the FOREIGN KEY refuses it even behind the repository's back", async () => {
      // The guard is not the count — it is products.category_id ON DELETE
      // RESTRICT, which cannot drift because it is not a number.
      const cat = await mk("Electronics");
      await addProduct(cat.id);
      await expect(
        admin`DELETE FROM categories WHERE id = ${cat.id}`,
      ).rejects.toThrow(/violates foreign key/);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("counts and attributes", () => {
    it("counts products by query, so it cannot go stale", async () => {
      const cat = await mk("Electronics");
      await addProduct(cat.id);
      await addProduct(cat.id);
      const found = await asTenant((tx) => repo.getCategory(tx, cat.id));
      expect(found.productCount).toBe(2);
    });

    it("stores attribute definitions as rows", async () => {
      const cat = await mk("Scales", null, {
        attributes: [
          { name: "Capacity", attributeType: "number", unit: "kg", isRequired: true },
          { name: "Platform size", attributeType: "text" },
        ],
      });
      const found = await asTenant((tx) => repo.getCategory(tx, cat.id));
      expect(found.attributes).toHaveLength(2);
      expect(found.attributes[0].unit).toBe("kg");
      expect(found.attributes[0].isRequired).toBe(true);
    });

    it("refuses two attributes with the same name on one category", async () => {
      await expect(
        mk("Scales", null, {
          attributes: [{ name: "Capacity" }, { name: "capacity" }],
        }),
      ).rejects.toThrow();
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("the stat tiles", () => {
    it("counts categories with products by JOIN, not by a cached number", async () => {
      const electronics = await mk("Electronics");
      const scales = await mk("Scales", electronics.id);
      await mk("Empty");
      await addProduct(scales.id);

      const stats = await asTenant((tx) => repo.getCategoryStats(tx));
      expect(stats.total).toBe(3);
      expect(stats.active).toBe(3);
      expect(stats.rootCategories).toBe(2); // Electronics and Empty
      expect(stats.withProducts).toBe(1); // only Scales
    });

    it("counts an inactive category as inactive", async () => {
      const cat = await mk("Retired");
      await asTenant((tx) => repo.updateCategory(tx, cat.id, { isActive: false }));
      const stats = await asTenant((tx) => repo.getCategoryStats(tx));
      expect(stats.inactive).toBe(1);
      expect(stats.active).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe("tenant isolation", () => {
    it("another company sees none of it", async () => {
      await mk("Electronics");
      const other = randomUUID();
      await admin`INSERT INTO companies (id, name, slug)
        VALUES (${other}, 'Other', ${"o-" + other.slice(0, 8)})`;

      const rows = await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.company_id', ${other}, true)`);
        return repo.listCategories(tx, {});
      });
      expect(rows).toHaveLength(0);
    });
  });
});
