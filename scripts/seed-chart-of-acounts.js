const { Account } = require("../app/models/account");

const { dbConnect } = require("../app/config/dbConnect");

const { MongoClient } = require("mongodb");

// ============================================
// SYSTEM ACCOUNTS (REQUIRED - CANNOT DELETE)
// ============================================
const systemAccounts = [
  // ============================================
  // ASSETS
  // ============================================
  {
    accountCode: "1000",
    accountName: "ASSETS",
    accountType: "asset",
    subType: null,
    parentAccount: null,
    canPost: false, // Header account
    isActive: true,
    level: 0,
    description: "All company assets",
  },
  {
    accountCode: "1100",
    accountName: "Current Assets",
    accountType: "asset",
    subType: null,
    parentAccount: null, // Will be set to "ASSETS" _id
    canPost: false,
    isActive: true,
    level: 1,
    description: "Assets expected to be converted to cash within one year",
  },
  {
    accountCode: "1110",
    accountName: "Cash",
    accountType: "asset",
    subType: "cash",
    systemAccount: "cash",
    parentAccount: null, // Will be set to "Current Assets" _id
    canPost: true,
    isActive: true,
    level: 2,
    description: "Physical cash on hand",
  },
  {
    accountCode: "1120",
    accountName: "Bank - Main Account",
    accountType: "asset",
    subType: "bank",
    systemAccount: "bank_main",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Primary bank account",
  },
  {
    accountCode: "1125",
    accountName: "M-Pesa",
    accountType: "asset",
    subType: "cash",
    systemAccount: "mpesa",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "M-Pesa mobile money account",
  },
  {
    accountCode: "1200",
    accountName: "Accounts Receivable",
    accountType: "asset",
    subType: "accounts_receivable",
    systemAccount: "accounts_receivable",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Amounts owed by customers",
  },
  {
    accountCode: "1300",
    accountName: "Inventory",
    accountType: "asset",
    subType: "inventory",
    systemAccount: "inventory",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Products held for sale",
  },
  {
    accountCode: "1310",
    accountName: "Technician Stock",
    accountType: "asset",
    subType: "inventory",
    systemAccount: "technician_stock",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Stock issued to technicians for demo, installation, or repair",
  },
  {
    accountCode: "1350",
    accountName: "VAT Input",
    accountType: "asset",
    subType: "vat_input",
    systemAccount: "vat_input",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "VAT paid on purchases (reclaimable from KRA)",
  },
  {
    accountCode: "1360",
    accountName: "Supplier Advance",
    accountType: "asset",
    subType: "prepaid_expense",
    systemAccount: "supplier_advance",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Prepayments to suppliers (overpayments on bills)",
  },

  // ============================================
  // LIABILITIES
  // ============================================
  {
    accountCode: "2000",
    accountName: "LIABILITIES",
    accountType: "liability",
    subType: null,
    parentAccount: null,
    canPost: false,
    isActive: true,
    level: 0,
    description: "All company liabilities",
  },
  {
    accountCode: "2100",
    accountName: "Current Liabilities",
    accountType: "liability",
    subType: null,
    parentAccount: null,
    canPost: false,
    isActive: true,
    level: 1,
    description: "Liabilities due within one year",
  },
  {
    accountCode: "2110",
    accountName: "Accounts Payable",
    accountType: "liability",
    subType: "accounts_payable",
    systemAccount: "accounts_payable",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Amounts owed to suppliers",
  },
  {
    accountCode: "2120",
    accountName: "VAT Output",
    accountType: "liability",
    subType: "vat_payable",
    systemAccount: "vat_output",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "VAT collected on sales (payable to KRA)",
  },
  {
    accountCode: "2130",
    accountName: "WHT Payable",
    accountType: "liability",
    subType: "wht_payable",
    systemAccount: "wht_payable",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Withholding tax to remit to KRA",
  },
  {
    accountCode: "2140",
    accountName: "Customer Advance",
    accountType: "liability",
    subType: "customer_deposit",
    systemAccount: "customer_advance",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Customer deposits and overpayments",
  },

  // ============================================
  // EQUITY
  // ============================================
  {
    accountCode: "3000",
    accountName: "EQUITY",
    accountType: "equity",
    subType: null,
    parentAccount: null,
    canPost: false,
    isActive: true,
    level: 0,
    description: "Owner's equity",
  },
  {
    accountCode: "3900",
    accountName: "Retained Earnings",
    accountType: "equity",
    subType: "retained_earnings",
    systemAccount: "retained_earnings",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 1,
    description: "Accumulated profits/losses",
  },

  // ============================================
  // REVENUE
  // ============================================
  {
    accountCode: "4000",
    accountName: "REVENUE",
    accountType: "revenue",
    subType: null,
    parentAccount: null,
    canPost: false,
    isActive: true,
    level: 0,
    description: "All company revenue",
  },
  {
    accountCode: "4100",
    accountName: "Sales Revenue",
    accountType: "revenue",
    subType: "sales",
    systemAccount: "sales_revenue",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 1,
    description: "Revenue from product sales",
  },
  {
    accountCode: "4200",
    accountName: "Service Revenue",
    accountType: "revenue",
    subType: "service_revenue",
    systemAccount: "service_revenue",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 1,
    description: "Revenue from services",
  },

  // ============================================
  // EXPENSES
  // ============================================
  {
    accountCode: "5000",
    accountName: "EXPENSES",
    accountType: "expense",
    subType: null,
    parentAccount: null,
    canPost: false,
    isActive: true,
    level: 0,
    description: "All company expenses",
  },
  {
    accountCode: "5100",
    accountName: "Cost of Goods Sold",
    accountType: "expense",
    subType: "cogs",
    systemAccount: "cogs",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 1,
    description: "Direct cost of products sold",
  },
];

// ============================================
// SUGGESTED ACCOUNTS (ADMIN CAN DELETE/MODIFY)
// ============================================
const suggestedAccounts = [
  // Additional Assets
  {
    accountCode: "1400",
    accountName: "Fixed Assets",
    accountType: "asset",
    subType: null,
    parentAccount: null,
    canPost: false,
    isActive: true,
    level: 1,
    description: "Long-term physical assets",
  },
  {
    accountCode: "1410",
    accountName: "Vehicles",
    accountType: "asset",
    subType: "fixed_asset",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Company vehicles",
  },
  {
    accountCode: "1420",
    accountName: "Office Equipment",
    accountType: "asset",
    subType: "fixed_asset",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Computers, furniture, etc.",
  },
  {
    accountCode: "1500",
    accountName: "Prepaid Expenses",
    accountType: "asset",
    subType: "prepaid_expense",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Expenses paid in advance",
  },

  // Additional Liabilities
  {
    accountCode: "2200",
    accountName: "Long-term Liabilities",
    accountType: "liability",
    subType: null,
    parentAccount: null,
    canPost: false,
    isActive: true,
    level: 1,
    description: "Liabilities due after one year",
  },
  {
    accountCode: "2210",
    accountName: "Loans Payable",
    accountType: "liability",
    subType: "loan",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Bank loans and financing",
  },

  // Additional Equity
  {
    accountCode: "3100",
    accountName: "Owner's Capital",
    accountType: "equity",
    subType: "owner_equity",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 1,
    description: "Owner's investment in the business",
  },
  {
    accountCode: "3200",
    accountName: "Owner's Drawings",
    accountType: "equity",
    subType: "drawings",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 1,
    description: "Owner's withdrawals from the business",
  },

  // Additional Revenue
  {
    accountCode: "4300",
    accountName: "Installation Revenue",
    accountType: "revenue",
    subType: "service_revenue",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Revenue from installation services",
  },
  {
    accountCode: "4400",
    accountName: "Maintenance Revenue",
    accountType: "revenue",
    subType: "service_revenue",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Revenue from maintenance services",
  },
  {
    accountCode: "4900",
    accountName: "Other Income",
    accountType: "revenue",
    subType: "other_income",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 1,
    description: "Miscellaneous income",
  },

  // Operating Expenses
  {
    accountCode: "5200",
    accountName: "Operating Expenses",
    accountType: "expense",
    subType: null,
    parentAccount: null,
    canPost: false,
    isActive: true,
    level: 1,
    description: "Day-to-day business expenses",
  },
  {
    accountCode: "5210",
    accountName: "Salaries & Wages",
    accountType: "expense",
    subType: "operating_expense",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Employee salaries and wages",
  },
  {
    accountCode: "5220",
    accountName: "Rent Expense",
    accountType: "expense",
    subType: "operating_expense",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Office/warehouse rent",
  },
  {
    accountCode: "5230",
    accountName: "Utilities",
    accountType: "expense",
    subType: "operating_expense",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Electricity, water, internet",
  },
  {
    accountCode: "5240",
    accountName: "Fuel & Transportation",
    accountType: "expense",
    subType: "operating_expense",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Fuel and vehicle expenses",
  },
  {
    accountCode: "5250",
    accountName: "Office Supplies",
    accountType: "expense",
    subType: "operating_expense",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Stationery, supplies, etc.",
  },
  {
    accountCode: "5260",
    accountName: "Marketing & Advertising",
    accountType: "expense",
    subType: "operating_expense",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Marketing and advertising costs",
  },
  {
    accountCode: "5270",
    accountName: "Professional Fees",
    accountType: "expense",
    subType: "operating_expense",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Legal, accounting, consulting fees",
  },
  {
    accountCode: "5280",
    accountName: "Bank Charges",
    accountType: "expense",
    subType: "operating_expense",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Bank fees and charges",
  },
  {
    accountCode: "5290",
    accountName: "Insurance Expense",
    accountType: "expense",
    subType: "operating_expense",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Business insurance premiums",
  },
  {
    accountCode: "5300",
    accountName: "Depreciation Expense",
    accountType: "expense",
    subType: "depreciation",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 2,
    description: "Depreciation of fixed assets",
  },
  {
    accountCode: "5400",
    accountName: "Inventory Adjustment",
    accountType: "expense",
    subType: "inventory_adjustment",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 1,
    description: "Inventory losses, damage, theft",
  },
  {
    accountCode: "5900",
    accountName: "Other Expenses",
    accountType: "expense",
    subType: "other_expense",
    parentAccount: null,
    canPost: true,
    isActive: true,
    level: 1,
    description: "Miscellaneous expenses",
  },
];

// ============================================
// SEED FUNCTION
// ============================================
async function seedChartOfAccounts() {
  try {
    await dbConnect();

    console.log("🌱 Seeding Chart of Accounts...");

    // Clear existing accounts (optional - comment out in production)
    // await Account.deleteMany({});
    // console.log("✅ Cleared existing accounts");

    // Check if system accounts already exist
    const existingSystemAccounts = await Account.countDocuments({
      systemAccount: { $ne: null },
    });

    if (existingSystemAccounts > 0) {
      console.log(
        `⚠️  ${existingSystemAccounts} system accounts already exist. Skipping seed.`
      );
      console.log("If you want to re-seed, delete accounts first.");
      process.exit(0);
    }

    // Create all accounts with parent relationships
    const allAccounts = [...systemAccounts, ...suggestedAccounts];
    const accountMap = new Map();

    // First pass: Create all accounts without parent relationships
    for (const accountData of allAccounts) {
      const account = await Account.create({
        ...accountData,
        createdBy: {
          name: "System",
          id: "system",
        },
      });
      accountMap.set(accountData.accountCode, account);
      console.log(
        `✅ Created account: ${account.accountCode} - ${account.accountName}`
      );
    }

    // Second pass: Set parent relationships
    for (const accountData of allAccounts) {
      if (accountData.parentAccount) {
        const account = accountMap.get(accountData.accountCode);
        const parent = accountMap.get(accountData.parentAccount);

        if (parent) {
          account.parentAccount = parent._id;
          account.ancestors = [parent._id];
          account.path = `${parent.accountCode}/${account.accountCode}`;
          await account.save();
          console.log(
            `  ↳ Linked ${account.accountCode} to parent ${parent.accountCode}`
          );
        }
      }
    }

    // Update parent relationships based on hierarchy
    const updateParentRelationships = async () => {
      // ASSETS hierarchy
      const assets = accountMap.get("1000");
      const currentAssets = accountMap.get("1100");
      const fixedAssets = accountMap.get("1400");

      if (currentAssets) {
        currentAssets.parentAccount = assets._id;
        currentAssets.ancestors = [assets._id];
        currentAssets.path = "1000/1100";
        await currentAssets.save();

        // Link children to Current Assets
        for (const code of [
          "1110",
          "1120",
          "1125",
          "1200",
          "1300",
          "1350",
          "1360", // Supplier Advance
          "1500",
        ]) {
          const child = accountMap.get(code);
          if (child) {
            child.parentAccount = currentAssets._id;
            child.ancestors = [assets._id, currentAssets._id];
            child.path = `1000/1100/${code}`;
            await child.save();
          }
        }
      }

      if (fixedAssets) {
        fixedAssets.parentAccount = assets._id;
        fixedAssets.ancestors = [assets._id];
        fixedAssets.path = "1000/1400";
        await fixedAssets.save();

        // Link children to Fixed Assets
        for (const code of ["1410", "1420"]) {
          const child = accountMap.get(code);
          if (child) {
            child.parentAccount = fixedAssets._id;
            child.ancestors = [assets._id, fixedAssets._id];
            child.path = `1000/1400/${code}`;
            await child.save();
          }
        }
      }

      // LIABILITIES hierarchy
      const liabilities = accountMap.get("2000");
      const currentLiabilities = accountMap.get("2100");
      const longTermLiabilities = accountMap.get("2200");

      if (currentLiabilities) {
        currentLiabilities.parentAccount = liabilities._id;
        currentLiabilities.ancestors = [liabilities._id];
        currentLiabilities.path = "2000/2100";
        await currentLiabilities.save();

        for (const code of ["2110", "2120", "2130", "2140"]) {
          const child = accountMap.get(code);
          if (child) {
            child.parentAccount = currentLiabilities._id;
            child.ancestors = [liabilities._id, currentLiabilities._id];
            child.path = `2000/2100/${code}`;
            await child.save();
          }
        }
      }

      if (longTermLiabilities) {
        longTermLiabilities.parentAccount = liabilities._id;
        longTermLiabilities.ancestors = [liabilities._id];
        longTermLiabilities.path = "2000/2200";
        await longTermLiabilities.save();

        for (const code of ["2210"]) {
          const child = accountMap.get(code);
          if (child) {
            child.parentAccount = longTermLiabilities._id;
            child.ancestors = [liabilities._id, longTermLiabilities._id];
            child.path = `2000/2200/${code}`;
            await child.save();
          }
        }
      }

      // EQUITY hierarchy
      const equity = accountMap.get("3000");
      for (const code of ["3100", "3200", "3900"]) {
        const child = accountMap.get(code);
        if (child) {
          child.parentAccount = equity._id;
          child.ancestors = [equity._id];
          child.path = `3000/${code}`;
          await child.save();
        }
      }

      // REVENUE hierarchy
      const revenue = accountMap.get("4000");
      for (const code of ["4100", "4200", "4300", "4400", "4900"]) {
        const child = accountMap.get(code);
        if (child) {
          child.parentAccount = revenue._id;
          child.ancestors = [revenue._id];
          child.path = `4000/${code}`;
          await child.save();
        }
      }

      // EXPENSES hierarchy
      const expenses = accountMap.get("5000");
      const operatingExpenses = accountMap.get("5200");

      // COGS
      const cogs = accountMap.get("5100");
      if (cogs) {
        cogs.parentAccount = expenses._id;
        cogs.ancestors = [expenses._id];
        cogs.path = "5000/5100";
        await cogs.save();
      }

      if (operatingExpenses) {
        operatingExpenses.parentAccount = expenses._id;
        operatingExpenses.ancestors = [expenses._id];
        operatingExpenses.path = "5000/5200";
        await operatingExpenses.save();

        for (const code of [
          "5210",
          "5220",
          "5230",
          "5240",
          "5250",
          "5260",
          "5270",
          "5280",
          "5290",
          "5300",
        ]) {
          const child = accountMap.get(code);
          if (child) {
            child.parentAccount = operatingExpenses._id;
            child.ancestors = [expenses._id, operatingExpenses._id];
            child.path = `5000/5200/${code}`;
            await child.save();
          }
        }
      }

      // Other standalone expenses
      for (const code of ["5400", "5900"]) {
        const child = accountMap.get(code);
        if (child) {
          child.parentAccount = expenses._id;
          child.ancestors = [expenses._id];
          child.path = `5000/${code}`;
          await child.save();
        }
      }
    };

    await updateParentRelationships();

    console.log("\n🎉 Chart of Accounts seeded successfully!");
    console.log(`✅ System Accounts: ${systemAccounts.length}`);
    console.log(`✅ Suggested Accounts: ${suggestedAccounts.length}`);
    console.log(`✅ Total Accounts: ${allAccounts.length}`);

    console.log("\n📊 Account Summary:");
    const summary = await Account.aggregate([
      {
        $group: {
          _id: "$accountType",
          count: { $sum: 1 },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    for (const item of summary) {
      console.log(`  ${item._id}: ${item.count} accounts`);
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding chart of accounts:", error);
    process.exit(1);
  }
}

// Run seed
seedChartOfAccounts();
