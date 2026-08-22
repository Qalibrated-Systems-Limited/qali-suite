"use server";

import { revalidatePath } from "next/cache";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { withAuthorizedTenant } from "../tenant";
import { userMessage } from "../errors";
import { FINANCE_WRITE_ROLES } from "@/lib/utils/role-gates";
import * as coffee from "../repositories/coffee";

/**
 * Coffee cooperative actions on Postgres (0058).
 *
 * The intake itself is raised by the connector, from the collection station —
 * these are the screens that read it back, plus season maintenance.
 *
 * RESULT SHAPES ARE THE PAGE'S. `app/dashboard/integrations/coffee-coop`
 * reads `_id`, `entryNumber`, `seasonName` and the rest as the Mongo action
 * returned them, so it moves by changing an import.
 */

export type ActionResult =
  | { success: true; seasonId?: string; message?: string }
  | { success: false; error: string; fieldErrors?: Record<string, string> };

const seasonSchema = z.object({
  name: z.string().min(2, "Give the season a name"),
  seasonType: z.enum(["main", "fly", "early"]).default("main"),
  year: z.coerce.number().int().min(2000).max(2100),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  targetVolumeKg: z.coerce.number().min(0).default(0),
  isActive: z.coerce.boolean().default(false),
  notes: z.string().optional().nullable(),
});

export async function getCoffeeSeasons() {
  try {
    return await withAuthorizedTenant([], async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT s.id, s.name, s.season_type::text AS season_type, s.year,
               s.start_date::text AS start_date, s.end_date::text AS end_date,
               s.is_active, s.target_volume_kg::float8 AS target_volume_kg,
               s.default_product_id, s.notes,
               COALESCE(i.intake_count, 0)::int      AS intake_count,
               COALESCE(i.total_kg, 0)::float8       AS total_kg,
               COALESCE(i.total_value, 0)::float8    AS total_value
          FROM coffee_seasons s
          LEFT JOIN (
            SELECT season_id,
                   COUNT(*) AS intake_count,
                   SUM(net_weight) AS total_kg,
                   SUM(total_amount) AS total_value
              FROM farmer_intake_entries
             WHERE status = 'recorded'
             GROUP BY season_id
          ) i ON i.season_id = s.id
         ORDER BY s.year DESC, s.name
      `)) as unknown as Array<Record<string, unknown>>;

      return rows.map((r) => ({
        _id: String(r.id),
        id: String(r.id),
        name: String(r.name),
        seasonType: String(r.season_type),
        year: Number(r.year),
        startDate: (r.start_date as string) ?? null,
        endDate: (r.end_date as string) ?? null,
        isActive: Boolean(r.is_active),
        targetVolumeKg: Number(r.target_volume_kg ?? 0),
        defaultProductId: (r.default_product_id as string) ?? null,
        notes: (r.notes as string) ?? null,
        intakeCount: Number(r.intake_count ?? 0),
        totalKg: Number(r.total_kg ?? 0),
        totalValue: Number(r.total_value ?? 0),
      }));
    });
  } catch {
    return [];
  }
}

export async function createCoffeeSeason(
  _prevState: unknown,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = seasonSchema.safeParse(Object.fromEntries(formData.entries()));
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return {
      success: false,
      error: issue?.message ?? "Please correct the highlighted fields",
      fieldErrors: { [String(issue?.path[0] ?? "_form")]: issue?.message ?? "" },
    };
  }
  const d = parsed.data;

  try {
    const season = await withAuthorizedTenant(
      [...FINANCE_WRITE_ROLES],
      async (tx, { user, companyId }) => {
        // Making this one active stands the previous one down. A partial
        // unique index allows exactly one, so without this the insert would
        // simply be refused — and "there is already an active season" is not
        // what somebody opening a new one means.
        if (d.isActive) {
          await tx.execute(sql`
            UPDATE coffee_seasons SET is_active = false, updated_at = now()
             WHERE is_active = true`);
        }

        const rows = (await tx.execute(sql`
          INSERT INTO coffee_seasons
            (company_id, name, season_type, year, start_date, end_date,
             is_active, target_volume_kg, notes, created_by_id, created_by_name)
          VALUES (${companyId}::uuid, ${d.name}, ${d.seasonType}::coffee_season_type,
                  ${d.year}, ${d.startDate || null}::date, ${d.endDate || null}::date,
                  ${d.isActive}, ${d.targetVolumeKg}, ${d.notes || null},
                  ${user.id}, ${user.name})
          RETURNING id
        `)) as unknown as Array<{ id: string }>;
        return rows[0];
      },
    );

    revalidatePath("/dashboard/integrations/coffee-coop");
    return {
      success: true,
      seasonId: season.id,
      message: `Season ${d.name} created`,
    };
  } catch (err) {
    return { success: false, error: userMessage(err, "Could not create the season") };
  }
}

export async function getCoffeeIntakes(
  opts: {
    seasonId?: string;
    farmerCode?: string;
    grade?: string;
    paymentStatus?: string;
    limit?: number;
  } = {},
) {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 200);
  try {
    return await withAuthorizedTenant([], async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT e.*, e.net_weight::float8 AS net_w, e.total_amount::float8 AS total_a,
               e.gross_weight::float8 AS gross_w, e.deduction_weight::float8 AS ded_w,
               e.unit_price::float8 AS unit_p, e.amount_paid::float8 AS paid_a
          FROM farmer_intake_entries e
         WHERE TRUE
           ${opts.seasonId ? sql`AND e.season_id = ${opts.seasonId}::uuid` : sql``}
           ${opts.farmerCode ? sql`AND e.farmer_code = ${opts.farmerCode}` : sql``}
           ${opts.grade ? sql`AND e.grade = ${opts.grade}` : sql``}
           ${opts.paymentStatus ? sql`AND e.payment_status = ${opts.paymentStatus}::farmer_payment_status` : sql``}
         ORDER BY e.created_at DESC
         LIMIT ${limit}
      `)) as unknown as Array<Record<string, unknown>>;

      return rows.map((r) => ({
        _id: String(r.id),
        entryNumber: String(r.entry_number),
        externalRef: (r.external_ref as string) ?? null,
        seasonId: (r.season_id as string) ?? null,
        seasonName: (r.season_name_at_intake as string) ?? "",
        farmerCode: String(r.farmer_code),
        farmerName: (r.farmer_name as string) ?? "",
        farmerPhone: (r.farmer_phone as string) ?? "",
        coffeeType: String(r.coffee_type),
        grade: String(r.grade),
        grossWeight: Number(r.gross_w ?? 0),
        deductionWeight: Number(r.ded_w ?? 0),
        netWeight: Number(r.net_w ?? 0),
        moisture: Number(r.moisture ?? 0),
        unitPrice: Number(r.unit_p ?? 0),
        totalAmount: Number(r.total_a ?? 0),
        currency: String(r.currency),
        paymentMethod: (r.payment_method as string) ?? null,
        paymentStatus: String(r.payment_status),
        amountPaid: Number(r.paid_a ?? 0),
        status: String(r.status),
        journalEntryId: (r.journal_entry_id as string) ?? null,
        stockMovementId: (r.stock_movement_id as string) ?? null,
        warnings: (r.warnings as string[]) ?? [],
        createdAt: r.created_at,
      }));
    });
  } catch {
    return [];
  }
}

/** The strip at the top of the collection page. */
export async function getCoffeeCoopStats() {
  const empty = {
    totalIntakes: 0, totalKg: 0, totalValue: 0, totalPaid: 0,
    outstanding: 0, farmers: 0, activeSeason: null as string | null,
  };
  try {
    return await withAuthorizedTenant([], async (tx) => {
      const rows = (await tx.execute(sql`
        SELECT COUNT(*)::int                                        AS total_intakes,
               COALESCE(SUM(net_weight), 0)::float8                 AS total_kg,
               COALESCE(SUM(total_amount), 0)::float8               AS total_value,
               COALESCE(SUM(amount_paid), 0)::float8                AS total_paid,
               COALESCE(SUM(total_amount - amount_paid), 0)::float8 AS outstanding,
               COUNT(DISTINCT farmer_code)::int                     AS farmers
          FROM farmer_intake_entries
         WHERE status = 'recorded'
      `)) as unknown as Array<Record<string, unknown>>;

      const season = await coffee.getActiveSeason(tx);
      const r = rows[0] ?? {};
      return {
        totalIntakes: Number(r.total_intakes ?? 0),
        totalKg: Number(r.total_kg ?? 0),
        totalValue: Number(r.total_value ?? 0),
        totalPaid: Number(r.total_paid ?? 0),
        outstanding: Number(r.outstanding ?? 0),
        farmers: Number(r.farmers ?? 0),
        activeSeason: season?.name ?? null,
      };
    });
  } catch {
    return empty;
  }
}

/** What one farmer has delivered and is still owed. */
export async function getFarmerPosition(farmerCode: string) {
  try {
    return await withAuthorizedTenant([], (tx) =>
      coffee.getFarmerPosition(tx, farmerCode),
    );
  } catch {
    return {
      farmerCode, deliveries: 0, totalKg: 0,
      totalValue: 0, totalPaid: 0, outstanding: 0,
    };
  }
}
