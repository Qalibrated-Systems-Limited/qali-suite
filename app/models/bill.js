import mongoose from "mongoose";

const Schema = mongoose.Schema;

// ============================================
// UTILITY: Format user for audit trail
// ============================================
function formatUserForAudit(user) {
  if (!user) {
    return { name: "System", id: "system" };
  }
  return {
    name: user.name || user.username || "Unknown User",
    id: user.id || user._id?.toString() || "unknown",
  };
}

// ============================================
// BILL SCHEMA - ACCOUNTS PAYABLE (WITH WHT & VAT)
// ============================================
const billSchema = new Schema(
  {
    // Bill Identification
    billNumber: {
      type: String,
      required: [true, "Bill number is required"],
      unique: true,
      index: true,
    },

    supplierInvoiceNumber: {
      type: String,
      trim: true,
    },

    billDate: {
      type: Date,
      required: [true, "Bill date is required"],
      index: true,
    },

    dueDate: {
      type: Date,
      required: [true, "Due date is required"],
      index: true,
      validate: {
        validator: function (value) {
          return value >= this.billDate;
        },
        message: "Due date cannot be before bill date",
      },
    },

    // Supplier Information
    supplier: {
      id: {
        type: String,
        required: [true, "Supplier ID is required"],
        index: true,
      },
      name: {
        type: String,
        required: [true, "Supplier name is required"],
        trim: true,
      },
      email: {
        type: String,
        trim: true,
        lowercase: true,
      },
      phone: {
        type: String,
        trim: true,
      },
      address: String,
      taxPin: {
        type: String,
        trim: true,
        uppercase: true,
      },
    },

    // Bill Lines
    lines: {
      type: [
        {
          description: {
            type: String,
            required: [true, "Line description is required"],
            trim: true,
          },
          quantity: {
            type: Number,
            required: [true, "Quantity is required"],
            min: [0.001, "Quantity must be greater than zero"],
          },
          unitPrice: {
            type: Number,
            required: [true, "Unit price is required"],
            min: [0, "Unit price cannot be negative"],
          },
          amount: {
            type: Number,
            required: [true, "Amount is required"],
            min: [0, "Amount cannot be negative"],
          },
          accountId: {
            type: Schema.Types.ObjectId,
            ref: "Account",
            required: [true, "Account is required"],
          },
          accountCode: String,
          accountName: String,

          // VAT on this line
          taxRate: {
            type: Number,
            default: 0,
            min: [0, "Tax rate cannot be negative"],
            max: [100, "Tax rate cannot exceed 100%"],
          },
          taxAmount: {
            type: Number,
            default: 0,
            min: [0, "Tax amount cannot be negative"],
          },

          // WHT on this line
          whtApplicable: {
            type: Boolean,
            default: false,
          },
          whtRate: {
            type: Number,
            default: 0,
            min: [0, "WHT rate cannot be negative"],
            max: [100, "WHT rate cannot exceed 100%"],
          },
          whtAmount: {
            type: Number,
            default: 0,
            min: [0, "WHT amount cannot be negative"],
          },
        },
      ],
      validate: {
        validator: function (lines) {
          return lines && lines.length > 0;
        },
        message: "Bill must have at least one line item",
      },
    },

    // Amounts
    subtotal: {
      type: Number,
      required: [true, "Subtotal is required"],
      min: [0, "Subtotal cannot be negative"],
    },

    taxAmount: {
      type: Number,
      default: 0,
      min: [0, "Tax amount cannot be negative"],
    },

    withholdingTaxAmount: {
      type: Number,
      default: 0,
      min: [0, "WHT amount cannot be negative"],
    },

    total: {
      type: Number,
      required: [true, "Total is required"],
      min: [0.01, "Total must be greater than zero"],
    },

    netPayable: {
      type: Number,
      min: [0, "Net payable cannot be negative"],
    },

    currency: {
      type: String,
      default: "KES",
      uppercase: true,
      trim: true,
    },

    // WHT Certificate Tracking
    whtCertificate: {
      issued: {
        type: Boolean,
        default: false,
      },
      certificateNumber: String,
      issuedDate: Date,
      issuedBy: {
        name: String,
        id: String,
      },
    },

    // Payment Status
    paymentStatus: {
      type: String,
      enum: {
        values: ["unpaid", "partial", "paid", "overdue"],
        message: "{VALUE} is not a valid payment status",
      },
      default: "unpaid",
      index: true,
    },

    amountPaid: {
      type: Number,
      default: 0,
      min: [0, "Amount paid cannot be negative"],
    },

    amountDue: {
      type: Number,
      default: 0,
    },

    // Payment History
    paymentHistory: [
      {
        paymentId: {
          type: Schema.Types.ObjectId,
          ref: "Payment",
          required: true,
        },
        amount: {
          type: Number,
          required: true,
          min: 0,
        },
        paymentDate: {
          type: Date,
          required: true,
        },
        paymentNumber: String,
        whtPaid: {
          type: Number,
          default: 0,
          min: 0,
        },
        whtRemittedToKRA: {
          type: Boolean,
          default: false,
        },
        whtRemittanceDate: Date,
      },
    ],

    // Accounting Link
    journalEntryId: {
      type: Schema.Types.ObjectId,
      ref: "JournalEntry",
      index: true,
    },

    // Status
    status: {
      type: String,
      enum: {
        values: ["draft", "approved", "paid", "cancelled", "disputed"],
        message: "{VALUE} is not a valid status",
      },
      default: "draft",
      index: true,
    },

    approvedAt: Date,
    approvedBy: {
      name: String,
      id: String,
    },

    // Notes & Attachments
    description: String,
    notes: String,

    attachments: [
      {
        filename: String,
        url: String,
        size: Number,
        mimeType: String,
        uploadedAt: {
          type: Date,
          default: Date.now,
        },
        uploadedBy: {
          name: String,
          id: String,
        },
      },
    ],

    // Audit Trail
    createdBy: {
      name: {
        type: String,
        required: [true, "Creator name is required"],
      },
      id: {
        type: String,
        required: [true, "Creator ID is required"],
      },
    },

    lastModifiedBy: {
      name: String,
      id: String,
    },

    cancelledAt: Date,
    cancelledBy: {
      name: String,
      id: String,
    },
    cancellationReason: String,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

// ============================================
// COMPOUND INDEXES FOR QUERY EFFICIENCY
// ============================================
billSchema.index({ billDate: -1, status: 1 });
billSchema.index({ dueDate: 1, paymentStatus: 1 });
billSchema.index({ "supplier.id": 1, status: 1 });
billSchema.index({ paymentStatus: 1, dueDate: 1 });
billSchema.index({ status: 1, billDate: -1 });

// WHT-specific indexes
billSchema.index({ withholdingTaxAmount: 1, status: 1, billDate: -1 });
billSchema.index({ "paymentHistory.whtRemittedToKRA": 1 });

// ============================================
// VIRTUALS
// ============================================
billSchema.virtual("isOverdue").get(function () {
  if (this.paymentStatus === "paid") return false;
  return new Date() > this.dueDate;
});

billSchema.virtual("daysOverdue").get(function () {
  if (!this.isOverdue) return 0;
  const diff = new Date() - this.dueDate;
  return Math.floor(diff / (1000 * 60 * 60 * 24));
});

billSchema.virtual("isFullyPaid").get(function () {
  return this.paymentStatus === "paid";
});

billSchema.virtual("hasAttachments").get(function () {
  return this.attachments && this.attachments.length > 0;
});

billSchema.virtual("hasWHT").get(function () {
  return this.withholdingTaxAmount > 0;
});

billSchema.virtual("hasVAT").get(function () {
  return this.taxAmount > 0;
});

billSchema.virtual("whtNeedsRemittance").get(function () {
  if (!this.hasWHT) return false;
  return this.paymentHistory.some(
    (payment) => payment.whtPaid > 0 && !payment.whtRemittedToKRA
  );
});

// ============================================
// VALIDATION METHODS
// ============================================

/**
 * Validate line item calculations
 */
billSchema.methods.validateLines = function () {
  for (const line of this.lines) {
    // 1. Validate amount = quantity × unit price
    const calculatedAmount = line.quantity * line.unitPrice;
    if (Math.abs(calculatedAmount - line.amount) > 0.01) {
      throw new Error(
        `Line amount for "${line.description}" incorrect. ` +
          `Expected: ${calculatedAmount.toFixed(2)}, Got: ${line.amount}`
      );
    }

    // 2. Validate VAT calculation
    if (line.taxRate > 0) {
      const calculatedTax = (line.amount * line.taxRate) / 100;
      if (Math.abs(calculatedTax - line.taxAmount) > 0.01) {
        throw new Error(
          `VAT calculation incorrect for "${line.description}". ` +
            `Expected: ${calculatedTax.toFixed(2)}, Got: ${line.taxAmount}`
        );
      }
    } else if (line.taxAmount > 0) {
      throw new Error(
        `Line "${line.description}" has tax amount but no tax rate`
      );
    }

    // 3. Validate WHT calculation
    if (line.whtApplicable && line.whtRate > 0) {
      const calculatedWHT = (line.amount * line.whtRate) / 100;
      if (Math.abs(calculatedWHT - line.whtAmount) > 0.01) {
        throw new Error(
          `WHT calculation incorrect for "${line.description}". ` +
            `Expected: ${calculatedWHT.toFixed(2)}, Got: ${line.whtAmount}`
        );
      }

      // Validate WHT doesn't exceed line amount
      if (line.whtAmount > line.amount) {
        throw new Error(
          `WHT amount (${line.whtAmount}) cannot exceed line amount (${line.amount}) ` +
            `for "${line.description}"`
        );
      }

      // Warn about unusual WHT rates
      const validWHTRates = [5, 10, 12, 15, 20];
      if (!validWHTRates.includes(line.whtRate)) {
        console.warn(
          `[Bill ${this.billNumber}] Unusual WHT rate ${line.whtRate}% for "${line.description}". ` +
            `Common Kenya WHT rates: 5%, 10%, 12%, 15%, 20%`
        );
      }
    } else if (line.whtAmount > 0) {
      throw new Error(
        `Line "${line.description}" has WHT amount but WHT not applicable or no rate`
      );
    }
  }

  return true;
};

/**
 * Validate bill amounts
 */
billSchema.methods.validateAmounts = function () {
  // 1. Validate subtotal = sum of line amounts
  const calculatedSubtotal = this.lines.reduce(
    (sum, line) => sum + (line.amount || 0),
    0
  );
  if (Math.abs(calculatedSubtotal - this.subtotal) > 0.01) {
    throw new Error(
      `Subtotal mismatch. Expected: ${calculatedSubtotal.toFixed(2)}, Got: ${
        this.subtotal
      }`
    );
  }

  // 2. Validate tax amount = sum of line tax amounts
  const calculatedTax = this.lines.reduce(
    (sum, line) => sum + (line.taxAmount || 0),
    0
  );
  if (Math.abs(calculatedTax - this.taxAmount) > 0.01) {
    throw new Error(
      `VAT mismatch. Expected: ${calculatedTax.toFixed(2)}, Got: ${
        this.taxAmount
      }`
    );
  }

  // 3. Validate WHT amount = sum of line WHT amounts
  const calculatedWHT = this.lines.reduce(
    (sum, line) => sum + (line.whtAmount || 0),
    0
  );
  if (Math.abs(calculatedWHT - this.withholdingTaxAmount) > 0.01) {
    throw new Error(
      `WHT mismatch. Expected: ${calculatedWHT.toFixed(2)}, Got: ${
        this.withholdingTaxAmount
      }`
    );
  }

  // 4. Validate total = subtotal + VAT
  const calculatedTotal = this.subtotal + this.taxAmount;
  if (Math.abs(calculatedTotal - this.total) > 0.01) {
    throw new Error(
      `Total mismatch. Subtotal (${this.subtotal}) + VAT (${this.taxAmount}) = ` +
        `${calculatedTotal.toFixed(2)}, but total is ${this.total}`
    );
  }

  // 5. Calculate and validate net payable = total - WHT
  this.netPayable = this.total - this.withholdingTaxAmount;
  if (this.netPayable < 0) {
    throw new Error(
      `Net payable cannot be negative. Total: ${this.total}, WHT: ${this.withholdingTaxAmount}`
    );
  }

  // 6. Calculate amount due
  this.amountDue = this.netPayable - (this.amountPaid || 0);
  if (this.amountDue < 0) {
    this.amountDue = 0; // Overpayment case
  }

  return true;
};

/**
 * Validate accounts exist and are valid
 */
billSchema.methods.validateAccounts = async function () {
  const Account = mongoose.model("Account");

  for (const line of this.lines) {
    const account = await Account.findById(line.accountId);

    if (!account) {
      throw new Error(
        `Account not found for line "${line.description}" (ID: ${line.accountId})`
      );
    }

    if (!account.isActive) {
      throw new Error(
        `Account "${account.accountName}" is inactive and cannot be used`
      );
    }

    if (!account.canPost) {
      throw new Error(
        `Cannot post to header account "${account.accountName}". ` +
          `Please select a detail account.`
      );
    }

    // Validate account type (must be expense or asset for bills)
    if (!["expense", "asset"].includes(account.accountType)) {
      throw new Error(
        `Invalid account type for bill line "${line.description}". ` +
          `Expected 'expense' or 'asset', got '${account.accountType}'. ` +
          `Account: ${account.accountName}`
      );
    }

    // Cache account details
    line.accountCode = account.accountCode;
    line.accountName = account.accountName;
  }

  return true;
};

/**
 * Complete validation before approval
 */
billSchema.methods.validateBeforeApproval = async function () {
  this.validateLines();
  this.validateAmounts();
  await this.validateAccounts();
  return true;
};

// ============================================
// APPROVE BILL (WITH TRANSACTION SAFETY)
// ============================================
billSchema.methods.approve = async function (approvedBy) {
  // Validate status
  if (this.status !== "draft") {
    throw new Error(
      `Can only approve draft bills. Current status: ${this.status}`
    );
  }

  // Format user
  const userInfo = formatUserForAudit(approvedBy);

  // Validate all business rules
  await this.validateBeforeApproval();

  let journalEntry = null;

  try {
    // Create and post journal entry
    journalEntry = await this.createJournalEntry(userInfo);

    // Update bill status
    this.status = "approved";
    this.approvedAt = new Date();
    this.approvedBy = userInfo;
    this.lastModifiedBy = userInfo;

    await this.save();

    return this;
  } catch (error) {
    // Rollback: Clean up journal entry if it was created
    if (journalEntry?._id) {
      try {
        const JournalEntry = mongoose.model("JournalEntry");
        const je = await JournalEntry.findById(journalEntry._id);

        if (je) {
          if (je.status === "posted") {
            await je.reverse(
              userInfo,
              `Rollback: Bill approval failed - ${error.message}`
            );
          } else {
            await JournalEntry.findByIdAndDelete(je._id);
          }
        }
      } catch (rollbackError) {
        console.error(
          `[CRITICAL] Failed to rollback journal entry ${journalEntry._id}:`,
          rollbackError
        );
      }
    }

    throw new Error(`Bill approval failed: ${error.message}`);
  }
};

// ============================================
// CREATE JOURNAL ENTRY (BUG-FREE)
// ============================================
billSchema.methods.createJournalEntry = async function (user) {
  // Check if journal entry already exists
  if (this.journalEntryId) {
    throw new Error(
      `Journal entry already exists for this bill (ID: ${this.journalEntryId})`
    );
  }

  const Account = mongoose.model("Account");
  const JournalEntry = mongoose.model("JournalEntry");

  // Format user
  const userInfo = formatUserForAudit(user);

  // ============================================
  // STEP 1: Validate all required accounts exist
  // ============================================
  const apAccount = await Account.findOne({
    systemAccount: "accounts_payable",
  });
  if (!apAccount) {
    throw new Error(
      "Accounts Payable account not configured. Please set up system account 'accounts_payable'"
    );
  }

  let whtAccount = null;
  if (this.hasWHT) {
    whtAccount = await Account.findOne({ systemAccount: "wht_payable" });
    if (!whtAccount) {
      throw new Error(
        "Withholding Tax Payable account not configured. Please set up system account 'wht_payable'"
      );
    }
  }

  let vatInputAccount = null;
  if (this.hasVAT) {
    vatInputAccount = await Account.findOne({ systemAccount: "vat_input" });
    if (!vatInputAccount) {
      throw new Error(
        "VAT Input account not configured. Please set up system account 'vat_input'"
      );
    }
  }

  // ============================================
  // STEP 2: Build journal entry lines
  // ============================================
  const lines = [];

  // DEBIT: Expense/Asset accounts (without VAT)
  for (const line of this.lines) {
    const account = await Account.findById(line.accountId);

    if (!account) {
      throw new Error(
        `Account ${line.accountId} not found for line "${line.description}"`
      );
    }

    lines.push({
      accountId: account._id,
      accountCode: account.accountCode,
      accountName: account.accountName,
      accountType: account.accountType,
      debit: line.amount,
      credit: 0,
      description: line.description,
    });
  }

  // DEBIT: VAT Input (if applicable)
  if (this.hasVAT) {
    lines.push({
      accountId: vatInputAccount._id,
      accountCode: vatInputAccount.accountCode,
      accountName: vatInputAccount.accountName,
      accountType: vatInputAccount.accountType,
      debit: this.taxAmount,
      credit: 0,
      description: `VAT Input on purchases from ${this.supplier.name}`,
    });
  }

  // CREDIT: WHT Payable (if applicable)
  if (this.hasWHT) {
    lines.push({
      accountId: whtAccount._id,
      accountCode: whtAccount.accountCode,
      accountName: whtAccount.accountName,
      accountType: whtAccount.accountType,
      debit: 0,
      credit: this.withholdingTaxAmount,
      description: `WHT Payable to KRA - ${this.supplier.name}`,
    });
  }

  // CREDIT: Accounts Payable (net payable)
  lines.push({
    accountId: apAccount._id,
    accountCode: apAccount.accountCode,
    accountName: apAccount.accountName,
    accountType: apAccount.accountType,
    debit: 0,
    credit: this.netPayable,
    description: `Amount owed to ${this.supplier.name}`,
  });

  // ============================================
  // STEP 3: Validate journal entry is balanced
  // ============================================
  const totalDebits = lines.reduce((sum, line) => sum + (line.debit || 0), 0);
  const totalCredits = lines.reduce((sum, line) => sum + (line.credit || 0), 0);

  if (Math.abs(totalDebits - totalCredits) > 0.01) {
    throw new Error(
      `Journal entry not balanced! ` +
        `Debits: ${totalDebits.toFixed(2)}, Credits: ${totalCredits.toFixed(
          2
        )}, ` +
        `Difference: ${(totalDebits - totalCredits).toFixed(2)}`
    );
  }

  // ============================================
  // STEP 4: Generate unique entry number
  // ============================================
  const entryNumber = await this.generateUniqueEntryNumber();

  // ============================================
  // STEP 5: Create journal entry
  // ============================================
  const journalEntry = await JournalEntry.create({
    entryNumber,
    entryDate: this.billDate,
    entryType: "purchase",
    description: this.buildJournalDescription(),
    lines,
    party: {
      type: "supplier",
      id: this.supplier.id,
      name: this.supplier.name,
      email: this.supplier.email,
      phone: this.supplier.phone,
    },
    dueDate: this.dueDate,
    amountOutstanding: this.netPayable,
    relatedDocuments: {
      billId: this._id,
      billNumber: this.billNumber,
    },
    status: "draft",
    createdBy: userInfo,
  });

  // ============================================
  // STEP 6: Post journal entry
  // ============================================
  try {
    await journalEntry.post(userInfo);
  } catch (error) {
    // Clean up draft journal entry
    await JournalEntry.findByIdAndDelete(journalEntry._id);
    throw new Error(`Failed to post journal entry: ${error.message}`);
  }

  // ============================================
  // STEP 7: Link journal entry to bill
  // ============================================
  this.journalEntryId = journalEntry._id;
  // Don't save here - let the caller decide when to save

  return journalEntry;
};

/**
 * Generate unique journal entry number (with retry logic)
 */
billSchema.methods.generateUniqueEntryNumber = async function () {
  const JournalEntry = mongoose.model("JournalEntry");
  const maxAttempts = 5;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    // Get last entry for this type
    const lastEntry = await JournalEntry.findOne({
      entryType: "purchase",
    })
      .sort({ entryNumber: -1 })
      .limit(1)
      .lean();

    // Generate next number
    let nextNum = 1;
    if (lastEntry?.entryNumber) {
      const match = lastEntry.entryNumber.match(/\d+$/);
      if (match) {
        nextNum = parseInt(match[0], 10) + 1;
      }
    }

    const entryNumber = `JE-BILL-${String(nextNum).padStart(4, "0")}`;

    // Check if this number already exists
    const exists = await JournalEntry.exists({ entryNumber });

    if (!exists) {
      return entryNumber;
    }

    // Wait before retry (exponential backoff)
    await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
  }

  // Fallback: Use timestamp-based unique number
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `JE-BILL-${timestamp}-${random}`;
};

/**
 * Build descriptive journal entry description
 */
billSchema.methods.buildJournalDescription = function () {
  let desc = `Bill from ${this.supplier.name}`;

  if (this.supplierInvoiceNumber) {
    desc += ` - Inv #${this.supplierInvoiceNumber}`;
  }

  const details = [];
  if (this.hasVAT) {
    details.push(`VAT: ${this.currency} ${this.taxAmount.toFixed(2)}`);
  }
  if (this.hasWHT) {
    details.push(
      `WHT: ${this.currency} ${this.withholdingTaxAmount.toFixed(2)}`
    );
  }

  if (details.length > 0) {
    desc += ` (${details.join(", ")})`;
  }

  return desc;
};

// ============================================
// RECORD PAYMENT (WITH PROPORTIONAL WHT)
// ============================================
billSchema.methods.recordPayment = async function (
  paymentId,
  amount,
  whtPaid = null
) {
  // Validate payment amount
  if (amount <= 0) {
    throw new Error("Payment amount must be greater than zero");
  }

  if (amount > this.amountDue + 0.01) {
    // Allow 1 cent tolerance for rounding
    throw new Error(
      `Payment amount (${amount}) exceeds amount due (${this.amountDue})`
    );
  }

  // Get payment record
  const Payment = mongoose.model("Payment");
  const payment = await Payment.findById(paymentId);

  if (!payment) {
    throw new Error(`Payment not found (ID: ${paymentId})`);
  }

  // Calculate proportional WHT if not provided
  if (whtPaid === null && this.hasWHT) {
    const paymentRatio = amount / this.netPayable;
    whtPaid = this.withholdingTaxAmount * paymentRatio;
    whtPaid = Math.round(whtPaid * 100) / 100; // Round to 2 decimals
  } else if (whtPaid === null) {
    whtPaid = 0;
  }

  // Validate WHT is proportional (with tolerance for rounding)
  if (this.hasWHT && whtPaid > 0) {
    const expectedWHT = (this.withholdingTaxAmount * amount) / this.netPayable;
    const tolerance = 1; // KES 1 tolerance

    if (Math.abs(whtPaid - expectedWHT) > tolerance) {
      console.warn(
        `[Bill ${this.billNumber}] WHT amount (${whtPaid}) differs from ` +
          `proportional amount (${expectedWHT.toFixed(2)}). Difference: ` +
          `${Math.abs(whtPaid - expectedWHT).toFixed(2)}`
      );
    }

    // Ensure WHT doesn't exceed total WHT
    if (whtPaid > this.withholdingTaxAmount) {
      throw new Error(
        `WHT paid (${whtPaid}) cannot exceed total WHT (${this.withholdingTaxAmount})`
      );
    }
  }

  // Add to payment history
  this.paymentHistory.push({
    paymentId: payment._id,
    amount: amount,
    paymentDate: payment.paymentDate,
    paymentNumber: payment.paymentNumber,
    whtPaid: whtPaid,
    whtRemittedToKRA: false,
  });

  // Update amounts
  this.amountPaid += amount;
  this.amountDue = this.netPayable - this.amountPaid;

  // Handle rounding
  if (Math.abs(this.amountDue) < 0.01) {
    this.amountDue = 0;
  }

  // Update payment status
  if (this.amountDue <= 0.01) {
    this.paymentStatus = "paid";
    this.status = "paid";
  } else if (this.amountPaid > 0) {
    this.paymentStatus = "partial";
  }

  // Update related journal entry
  if (this.journalEntryId) {
    const JournalEntry = mongoose.model("JournalEntry");
    const je = await JournalEntry.findById(this.journalEntryId);

    if (je) {
      je.amountPaid = this.amountPaid;
      je.amountOutstanding = this.amountDue;
      je.isFullyPaid = this.amountDue <= 0.01;
      await je.save();
    }
  }

  await this.save();
  return this;
};

// ============================================
// ISSUE WHT CERTIFICATE
// ============================================
billSchema.methods.issueWHTCertificate = async function (
  issuedBy,
  certificateNumber
) {
  if (!this.hasWHT) {
    throw new Error("No withholding tax on this bill");
  }

  if (this.whtCertificate.issued) {
    throw new Error(
      `WHT certificate already issued (${this.whtCertificate.certificateNumber})`
    );
  }

  if (this.paymentStatus !== "paid") {
    throw new Error("Bill must be fully paid before issuing WHT certificate");
  }

  const userInfo = formatUserForAudit(issuedBy);

  this.whtCertificate = {
    issued: true,
    certificateNumber: certificateNumber,
    issuedDate: new Date(),
    issuedBy: userInfo,
  };

  this.lastModifiedBy = userInfo;
  await this.save();

  return this;
};

// ============================================
// MARK WHT AS REMITTED TO KRA
// ============================================
billSchema.methods.markWHTRemitted = async function (
  paymentHistoryId,
  remittedBy
) {
  const payment = this.paymentHistory.id(paymentHistoryId);

  if (!payment) {
    throw new Error(`Payment not found in history (ID: ${paymentHistoryId})`);
  }

  if (payment.whtPaid <= 0) {
    throw new Error("No WHT was paid in this payment");
  }

  if (payment.whtRemittedToKRA) {
    throw new Error(
      `WHT already marked as remitted on ${payment.whtRemittanceDate?.toISOString()}`
    );
  }

  const userInfo = formatUserForAudit(remittedBy);

  payment.whtRemittedToKRA = true;
  payment.whtRemittanceDate = new Date();

  this.lastModifiedBy = userInfo;
  await this.save();

  return this;
};

// ============================================
// CANCEL BILL (WITH SAFETY CHECKS)
// ============================================
billSchema.methods.cancel = async function (cancelledBy, reason) {
  // Validate can cancel
  if (this.status === "paid") {
    throw new Error("Cannot cancel a fully paid bill");
  }

  if (this.status === "cancelled") {
    throw new Error("Bill is already cancelled");
  }

  if (this.paymentHistory.length > 0) {
    throw new Error(
      "Cannot cancel a bill with payment history. Please reverse payments first."
    );
  }

  const userInfo = formatUserForAudit(cancelledBy);

  // Reverse journal entry if exists
  if (this.journalEntryId) {
    const JournalEntry = mongoose.model("JournalEntry");
    const journalEntry = await JournalEntry.findById(this.journalEntryId);

    if (journalEntry) {
      if (journalEntry.status === "posted") {
        await journalEntry.reverse(userInfo, reason || "Bill cancelled");
      } else {
        // Delete draft journal entry
        await JournalEntry.findByIdAndDelete(journalEntry._id);
      }
    }
  }

  // Update bill status
  this.status = "cancelled";
  this.cancelledAt = new Date();
  this.cancelledBy = userInfo;
  this.cancellationReason = reason || "No reason provided";
  this.lastModifiedBy = userInfo;

  await this.save();

  return this;
};

// ============================================
// STATIC METHODS - QUERIES
// ============================================

/**
 * Get unpaid bills
 */
billSchema.statics.getUnpaidBills = function (supplierId = null) {
  const query = {
    paymentStatus: { $in: ["unpaid", "partial"] },
    status: "approved",
  };

  if (supplierId) {
    query["supplier.id"] = supplierId;
  }

  return this.find(query).sort({ dueDate: 1 }).lean();
};

/**
 * Get overdue bills
 */
billSchema.statics.getOverdueBills = function (supplierId = null) {
  const query = {
    paymentStatus: { $in: ["unpaid", "partial"] },
    status: "approved",
    dueDate: { $lt: new Date() },
  };

  if (supplierId) {
    query["supplier.id"] = supplierId;
  }

  return this.find(query).sort({ dueDate: 1 }).lean();
};

/**
 * Get bills by supplier
 */
billSchema.statics.getBillsBySupplier = function (supplierId) {
  return this.find({
    "supplier.id": supplierId,
    status: { $ne: "cancelled" },
  })
    .sort({ billDate: -1 })
    .lean();
};

/**
 * Get bills with unremitted WHT
 */
billSchema.statics.getBillsWithUnremittedWHT = function () {
  return this.find({
    withholdingTaxAmount: { $gt: 0 },
    "paymentHistory.whtPaid": { $gt: 0 },
    "paymentHistory.whtRemittedToKRA": false,
  })
    .sort({ billDate: -1 })
    .lean();
};

/**
 * Get total WHT for a period (for KRA remittance)
 */
billSchema.statics.getTotalWHTForPeriod = async function (startDate, endDate) {
  const result = await this.aggregate([
    {
      $match: {
        billDate: { $gte: startDate, $lte: endDate },
        status: { $in: ["approved", "paid"] },
        withholdingTaxAmount: { $gt: 0 },
      },
    },
    {
      $group: {
        _id: null,
        totalWHT: { $sum: "$withholdingTaxAmount" },
        totalBillAmount: { $sum: "$total" },
        count: { $sum: 1 },
      },
    },
  ]);

  return result[0] || { totalWHT: 0, totalBillAmount: 0, count: 0 };
};

/**
 * Get WHT report by supplier
 */
billSchema.statics.getWHTReportBySupplier = async function (
  startDate,
  endDate
) {
  return this.aggregate([
    {
      $match: {
        billDate: { $gte: startDate, $lte: endDate },
        status: { $in: ["approved", "paid"] },
        withholdingTaxAmount: { $gt: 0 },
      },
    },
    {
      $group: {
        _id: {
          supplierId: "$supplier.id",
          supplierName: "$supplier.name",
          taxPin: "$supplier.taxPin",
        },
        totalWHT: { $sum: "$withholdingTaxAmount" },
        totalBillAmount: { $sum: "$total" },
        billCount: { $sum: 1 },
      },
    },
    {
      $project: {
        _id: 0,
        supplierId: "$_id.supplierId",
        supplierName: "$_id.supplierName",
        taxPin: "$_id.taxPin",
        totalWHT: 1,
        totalBillAmount: 1,
        billCount: 1,
      },
    },
    {
      $sort: { totalWHT: -1 },
    },
  ]);
};

/**
 * Get bills summary for a supplier
 */
billSchema.statics.getSupplierSummary = async function (supplierId) {
  const result = await this.aggregate([
    {
      $match: {
        "supplier.id": supplierId,
        status: { $ne: "cancelled" },
      },
    },
    {
      $group: {
        _id: "$paymentStatus",
        count: { $sum: 1 },
        totalAmount: { $sum: "$netPayable" },
        totalPaid: { $sum: "$amountPaid" },
        totalDue: { $sum: "$amountDue" },
      },
    },
  ]);

  return result;
};

// ============================================
// MODEL EXPORT
// ============================================
const models = mongoose.models;
let Bill = models?.Bill;

if (!Bill) {
  Bill = mongoose.model("Bill", billSchema);
}

export default Bill;
