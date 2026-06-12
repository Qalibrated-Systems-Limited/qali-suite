"use server";

import { auth } from "@/auth";
import DeliveryNote from "../../models/dnote";

import { startOfMonth, endOfMonth } from "date-fns";
import dbConnect from "@/app/config/dbConnect";
import { getTenantContext, buildTenantMatch } from "@/lib/utils/tenant-utils";

// ============================================
// SEARCH DELIVERY NOTES (WITH PAGINATION)
// ============================================
const ITEMS_PER_PAGE = 20;
export async function searchDeliveryNotes(
  searchTerm = "",
  page = 1,
  filters = {}
) {
  await dbConnect();
  try {
    // Get tenant context
    const { companyId, isSuperAdmin } = await getTenantContext();
    const tenantMatch = buildTenantMatch(companyId, isSuperAdmin);

    const skipRecords = (page - 1) * ITEMS_PER_PAGE;

    const { returnType, startDate, endDate, reason, technician } = filters;

    // Build filter conditions
    let additionalFilters = { ...tenantMatch };

    // Return type filter
    if (returnType && returnType !== "all") {
      if (returnType === "returnable") {
        additionalFilters.shouldBeReturned = true;
      } else if (returnType === "sold") {
        additionalFilters.shouldBeReturned = false;
      }
    }

    // Reason filter
    if (reason && reason !== "all") {
      additionalFilters.reason = reason;
    }

    // Technician filter
    if (technician) {
      additionalFilters["technician.name"] = {
        $regex: technician,
        $options: "i",
      };
    }

    // Date range filter
    if (startDate || endDate) {
      additionalFilters.date = {};
      if (startDate) {
        additionalFilters.date.$gte = new Date(startDate);
      }
      if (endDate) {
        const endDateTime = new Date(endDate);
        endDateTime.setDate(endDateTime.getDate() + 1);
        additionalFilters.date.$lt = endDateTime;
      }
    }

    // Search stage
    const searchStage = {
      $match: {
        $and: [
          additionalFilters,
          {
            $or: [
              { deliveryNumber: { $regex: searchTerm, $options: "i" } },
              { "customer.name": { $regex: searchTerm, $options: "i" } },
              { "customer.phone": { $regex: searchTerm, $options: "i" } },
              { "technician.name": { $regex: searchTerm, $options: "i" } },
              { reason: { $regex: searchTerm, $options: "i" } },
            ],
          },
        ],
      },
    };

    const baseFilterStage = {
      $match: additionalFilters,
    };

    const paginationStage = [
      { $skip: skipRecords },
      { $limit: ITEMS_PER_PAGE },
    ];

    const sortStage = { $sort: { date: -1, createdAt: -1 } };

    let pipeline = [baseFilterStage, sortStage, ...paginationStage];

    if (searchTerm && searchTerm.length > 0) {
      pipeline = [searchStage, sortStage, ...paginationStage];
    }

    let result = await DeliveryNote.aggregate(pipeline);

    // Properly serialize all data
    result = result.map((dnote) => ({
      ...dnote,
      _id: dnote._id.toString(),
      date: dnote.date?.toISOString() || dnote.createdAt?.toISOString(),
      createdAt: dnote.createdAt?.toISOString(),
      // Serialize items array
      items:
        dnote.items?.map((item) => ({
          ...item,
          _id: item._id?.toString(),
        })) || [],
      // Serialize customer
      customer: {
        ...dnote.customer,
        id: dnote.customer?.id?.toString() || null,
      },
      // Serialize technician
      technician: dnote.technician
        ? {
            ...dnote.technician,
            id: dnote.technician.id?.toString() || null,
          }
        : null,
      // Serialize createdBy
      createdBy: dnote.createdBy
        ? {
            ...dnote.createdBy,
            id: dnote.createdBy.id?.toString() || null,
          }
        : null,
    }));

    return result;
  } catch (error) {
    console.error("Error searching delivery notes:", error);
    return [];
  }
}

// ============================================
// FETCH DELIVERY NOTE PAGES (FOR PAGINATION)
// ============================================
export async function fetchDeliveryNotePages(searchTerm = "", filters = {}) {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error("Unauthorized");
    }

    const ITEMS_PER_PAGE = 20;
    const { returnType, startDate, endDate, reason, technician } = filters;

    let additionalFilters = {};

    // Return type filter
    if (returnType && returnType !== "all") {
      if (returnType === "returnable") {
        additionalFilters.shouldBeReturned = true;
      } else if (returnType === "sold") {
        additionalFilters.shouldBeReturned = false;
      }
    }

    // Reason filter
    if (reason && reason !== "all") {
      additionalFilters.reason = reason;
    }

    // Technician filter
    if (technician) {
      additionalFilters["technician.name"] = {
        $regex: technician,
        $options: "i",
      };
    }

    // Date range filter
    if (startDate || endDate) {
      additionalFilters.date = {};
      if (startDate) {
        additionalFilters.date.$gte = new Date(startDate);
      }
      if (endDate) {
        const endDateTime = new Date(endDate);
        endDateTime.setDate(endDateTime.getDate() + 1);
        additionalFilters.date.$lt = endDateTime;
      }
    }

    const searchStage = {
      $match: {
        $and: [
          additionalFilters,
          {
            $or: [
              { deliveryNumber: { $regex: searchTerm, $options: "i" } },
              { "customer.name": { $regex: searchTerm, $options: "i" } },
              { "customer.phone": { $regex: searchTerm, $options: "i" } },
              { "technician.name": { $regex: searchTerm, $options: "i" } },
              { reason: { $regex: searchTerm, $options: "i" } },
            ],
          },
        ],
      },
    };

    const baseFilterStage = {
      $match: additionalFilters,
    };

    const countStage = {
      $count: "totalRecords",
    };

    let pipeline = [baseFilterStage, countStage];

    if (searchTerm && searchTerm.length > 0) {
      pipeline = [searchStage, countStage];
    }

    const result = await DeliveryNote.aggregate(pipeline);

    let count = 0;
    if (result && result.length > 0) {
      count = result[0].totalRecords;
    }

    const noOfPages = Math.ceil(Number(count) / ITEMS_PER_PAGE);

    return noOfPages;
  } catch (error) {
    console.error("Error fetching delivery note pages:", error);
    return 0;
  }
}

// ============================================
// GET ALL DELIVERY NOTES (DEPRECATED - USE searchDeliveryNotes)
// ============================================
export async function getDeliveryNotes(filters = {}) {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error("Unauthorized");
    }

    // Use searchDeliveryNotes with no search term and page 1
    return await searchDeliveryNotes("", 1, filters);
  } catch (error) {
    console.error("Error fetching delivery notes:", error);
    return [];
  }
}

// ============================================
// GET DELIVERY NOTE BY ID
// ============================================
export async function getDeliveryNoteById(id) {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error("Unauthorized");
    }

    const deliveryNote = await DeliveryNote.findById(id).lean();

    if (!deliveryNote) {
      return null;
    }

    return JSON.parse(JSON.stringify(deliveryNote));
  } catch (error) {
    console.error("Error fetching delivery note:", error);
    return null;
  }
}

// ============================================
// GET DELIVERY NOTES STATS
// ============================================
export async function getDeliveryNotesStats() {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error("Unauthorized");
    }

    // Use aggregation for better performance
    const statsResult = await DeliveryNote.aggregate([
      {
        $facet: {
          total: [{ $count: "count" }],
          sales: [
            { $match: { shouldBeReturned: false } },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                value: {
                  $sum: {
                    $reduce: {
                      input: "$items",
                      initialValue: 0,
                      in: {
                        $add: [
                          "$$value",
                          {
                            $multiply: [
                              { $ifNull: ["$$this.quantity", 0] },
                              { $ifNull: ["$$this.unitPrice", 0] },
                            ],
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          ],
          returnable: [
            { $match: { shouldBeReturned: true } },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                value: {
                  $sum: {
                    $reduce: {
                      input: "$items",
                      initialValue: 0,
                      in: {
                        $add: [
                          "$$value",
                          {
                            $multiply: [
                              { $ifNull: ["$$this.quantity", 0] },
                              { $ifNull: ["$$this.unitPrice", 0] },
                            ],
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          ],
          thisMonth: [
            {
              $match: {
                date: {
                  $gte: startOfMonth(new Date()),
                  $lte: endOfMonth(new Date()),
                },
              },
            },
            {
              $group: {
                _id: null,
                count: { $sum: 1 },
                value: {
                  $sum: {
                    $reduce: {
                      input: "$items",
                      initialValue: 0,
                      in: {
                        $add: [
                          "$$value",
                          {
                            $multiply: [
                              { $ifNull: ["$$this.quantity", 0] },
                              { $ifNull: ["$$this.unitPrice", 0] },
                            ],
                          },
                        ],
                      },
                    },
                  },
                },
              },
            },
          ],
        },
      },
    ]);

    const result = statsResult[0];

    return {
      total: result.total[0]?.count || 0,
      sales: result.sales[0]?.count || 0,
      salesValue: result.sales[0]?.value || 0,
      returnable: result.returnable[0]?.count || 0,
      returnableValue: result.returnable[0]?.value || 0,
      thisMonth: result.thisMonth[0]?.count || 0,
      thisMonthValue: result.thisMonth[0]?.value || 0,
    };
  } catch (error) {
    console.error("Error calculating delivery notes stats:", error);
    return {
      total: 0,
      sales: 0,
      returnable: 0,
      salesValue: 0,
      returnableValue: 0,
      thisMonth: 0,
      thisMonthValue: 0,
    };
  }
}

// ============================================
// GET DELIVERY NOTES BY CUSTOMER
// ============================================
export async function getDeliveryNotesByCustomer(customerId) {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error("Unauthorized");
    }

    const deliveryNotes = await DeliveryNote.find({
      "customer.id": customerId,
    })
      .sort({ date: -1 })
      .lean();

    return JSON.parse(JSON.stringify(deliveryNotes));
  } catch (error) {
    console.error("Error fetching delivery notes by customer:", error);
    return [];
  }
}

// ============================================
// GET RETURNABLE DELIVERY NOTES
// ============================================
export async function getReturnableDeliveryNotes() {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error("Unauthorized");
    }

    const deliveryNotes = await DeliveryNote.find({
      shouldBeReturned: true,
    })
      .sort({ date: -1 })
      .lean();

    return JSON.parse(JSON.stringify(deliveryNotes));
  } catch (error) {
    console.error("Error fetching returnable delivery notes:", error);
    return [];
  }
}

// ============================================
// GET UNIQUE REASONS (FOR FILTER DROPDOWN)
// ============================================
export async function getUniqueReasons() {
  try {
    const { companyId, isSuperAdmin } = await getTenantContext();
    // distinct() doesn't auto-cast — scope via buildTenantMatch (ObjectId-cast)
    // so it stays tenant-isolated and hits the companyId index.
    const reasons = await DeliveryNote.distinct(
      "reason",
      buildTenantMatch(companyId, isSuperAdmin),
    );
    return reasons.filter(Boolean); // Remove null/undefined
  } catch (error) {
    console.error("Error fetching unique reasons:", error);
    return [];
  }
}

// ============================================
// GET UNIQUE TECHNICIANS (FOR FILTER DROPDOWN)
// ============================================
export async function getUniqueTechnicians() {
  try {
    const session = await auth();
    if (!session?.user) {
      throw new Error("Unauthorized");
    }

    const { companyId, isSuperAdmin } = await getTenantContext();
    const technicians = await DeliveryNote.distinct(
      "technician.name",
      buildTenantMatch(companyId, isSuperAdmin),
    );
    return technicians.filter(Boolean); // Remove null/undefined
  } catch (error) {
    console.error("Error fetching unique technicians:", error);
    return [];
  }
}
