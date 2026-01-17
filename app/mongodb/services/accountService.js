import Account from "../../models/account";
import JournalEntry from "../../models/JournalEntry";
import dbConnect from "../../config/dbConnect";

// ============================================
// ACCOUNT SERVICE - ORCHESTRATION LAYER
// Uses schema methods where they exist
// ============================================

export class AccountService {
  /**
   * Create account with hierarchy management
   */
  static async createAccount(data, user) {
    await dbConnect();

    // Validate uniqueness
    const existingAccount = await Account.findOne({
      accountCode: data.accountCode,
    });

    if (existingAccount) {
      throw new Error(`Account code ${data.accountCode} already exists`);
    }

    if (data.systemAccount) {
      const existingSystem = await Account.findOne({
        systemAccount: data.systemAccount,
      });
      if (existingSystem) {
        throw new Error(`System account ${data.systemAccount} already exists`);
      }
    }

    // Handle hierarchy
    if (data.parentAccount) {
      const parent = await Account.findById(data.parentAccount);
      if (!parent) throw new Error("Parent account not found");

      if (parent.accountType !== data.accountType) {
        throw new Error(
          `Parent type (${parent.accountType}) must match child type (${data.accountType})`
        );
      }

      data.ancestors = [...(parent.ancestors || []), parent._id];
      data.level = (parent.level || 0) + 1;
      data.path = parent.path
        ? `${parent.path}/${data.accountCode}`
        : data.accountCode;

      if (parent.canPost) {
        parent.canPost = false;
        await parent.save();
      }
    } else {
      data.ancestors = [];
      data.level = 0;
      data.path = data.accountCode;
    }

    return await Account.create({
      ...data,
      createdBy: { name: user.name, id: user.id },
    });
  }

  /**
   * Get accounts with filters
   */
  static async getAccounts(filters = {}) {
    await dbConnect();

    const query = { isActive: true };
    if (filters.accountType) query.accountType = filters.accountType;
    if (filters.canPost !== undefined) query.canPost = filters.canPost;
    if (filters.subType) query.subType = filters.subType;
    if (filters.systemAccount) query.systemAccount = filters.systemAccount;

    return await Account.find(query).sort({ accountCode: 1 }).lean();
  }

  /**
   * Get chart of accounts (hierarchical)
   */
  static async getChartOfAccounts() {
    await dbConnect();

    const accounts = await Account.find({ isActive: true })
      .sort({ accountCode: 1 })
      .lean();

    const accountMap = new Map();
    const rootAccounts = [];

    accounts.forEach((account) => {
      accountMap.set(account._id.toString(), { ...account, children: [] });
    });

    accounts.forEach((account) => {
      const node = accountMap.get(account._id.toString());
      if (account.parentAccount) {
        const parent = accountMap.get(account.parentAccount.toString());
        if (parent) parent.children.push(node);
        else rootAccounts.push(node);
      } else {
        rootAccounts.push(node);
      }
    });

    return rootAccounts;
  }

  /**
   * Get account by ID - USES SCHEMA METHOD for balance
   */
  static async getAccountById(accountId, includeBalance = false) {
    await dbConnect();

    const account = await Account.findById(accountId);
    if (!account) throw new Error("Account not found");

    if (includeBalance) {
      // USE SCHEMA METHOD
      await account.calculateActualBalance();
    }

    return account.toObject();
  }

  /**
   * Update account
   */
  static async updateAccount(accountId, data, user) {
    await dbConnect();

    const account = await Account.findById(accountId);
    if (!account) throw new Error("Account not found");

    if (account.systemAccount && data.systemAccount !== account.systemAccount) {
      throw new Error("Cannot change system account designation");
    }

    if (data.accountType && data.accountType !== account.accountType) {
      const hasTransactions = await this.hasTransactions(accountId);
      if (hasTransactions) {
        throw new Error(
          "Cannot change account type with existing transactions"
        );
      }
    }

    Object.keys(data).forEach((key) => {
      if (key !== "systemAccount" && key !== "accountCode") {
        account[key] = data[key];
      }
    });

    account.lastModifiedBy = { name: user.name, id: user.id };
    await account.save();

    return account;
  }

  /**
   * Delete account - USES SCHEMA METHOD for validation
   */
  static async deleteAccount(accountId, user) {
    await dbConnect();

    const account = await Account.findById(accountId);
    if (!account) throw new Error("Account not found");

    // USE SCHEMA METHOD if it exists
    if (typeof account.canDelete === "function") {
      const validation = await account.canDelete();
      if (!validation.canDelete) {
        throw new Error(validation.reason);
      }
    } else {
      // Fallback validation
      if (account.systemAccount) {
        throw new Error(`Cannot delete system account: ${account.accountName}`);
      }

      const childCount = await Account.countDocuments({
        parentAccount: accountId,
        isActive: true,
      });

      if (childCount > 0) {
        throw new Error(
          `Cannot delete account with ${childCount} child account(s)`
        );
      }

      const hasTransactions = await this.hasTransactions(accountId);
      if (hasTransactions) {
        throw new Error("Cannot delete account with existing transactions");
      }
    }

    account.isActive = false;
    account.lastModifiedBy = { name: user.name, id: user.id };
    await account.save();

    if (account.parentAccount) {
      const parent = await Account.findById(account.parentAccount);
      const siblingCount = await Account.countDocuments({
        parentAccount: account.parentAccount,
        isActive: true,
        _id: { $ne: accountId },
      });

      if (siblingCount === 0) {
        parent.canPost = true;
        await parent.save();
      }
    }

    return account;
  }

  /**
   * Calculate balance - USES SCHEMA METHOD
   */
  static async calculateAccountBalance(accountId) {
    await dbConnect();

    const account = await Account.findById(accountId);
    if (!account) throw new Error("Account not found");

    // USE SCHEMA METHOD
    return await account.calculateActualBalance();
  }

  /**
   * Get balance with children - USES SCHEMA METHOD
   */
  static async getBalanceWithChildren(accountId) {
    await dbConnect();

    const account = await Account.findById(accountId);
    if (!account) throw new Error("Account not found");

    // USE SCHEMA METHOD
    return await account.getBalanceWithChildren();
  }

  /**
   * Get postable accounts - USES SCHEMA STATIC if exists
   */
  static async getPostableAccounts(accountType = null) {
    await dbConnect();

    // USE SCHEMA STATIC if available
    if (typeof Account.getPostableAccounts === "function") {
      return await Account.getPostableAccounts(accountType);
    }

    // Fallback
    const query = { canPost: true, isActive: true };
    if (accountType) query.accountType = accountType;

    return await Account.find(query)
      .sort({ accountCode: 1 })
      .select("accountCode accountName accountType subType")
      .lean();
  }

  /**
   * Get system account - USES SCHEMA STATIC if exists
   */
  static async getSystemAccount(systemAccountName) {
    await dbConnect();

    // USE SCHEMA STATIC if available
    if (typeof Account.getSystemAccount === "function") {
      return await Account.getSystemAccount(systemAccountName);
    }

    // Fallback
    const account = await Account.findOne({
      systemAccount: systemAccountName,
      isActive: true,
    }).lean();

    if (!account) {
      throw new Error(
        `System account "${systemAccountName}" not found. Configure in Chart of Accounts.`
      );
    }

    return account;
  }

  /**
   * Get accounts by type - USES SCHEMA STATIC if exists
   */
  static async getAccountsByType(accountType) {
    await dbConnect();

    // USE SCHEMA STATIC if available
    if (typeof Account.getByType === "function") {
      return await Account.getByType(accountType);
    }

    // Fallback
    return await Account.find({
      accountType,
      isActive: true,
    })
      .sort({ accountCode: 1 })
      .lean();
  }

  /**
   * Get root accounts - USES SCHEMA STATIC if exists
   */
  static async getRootAccounts() {
    await dbConnect();

    // USE SCHEMA STATIC if available
    if (typeof Account.getRootAccounts === "function") {
      return await Account.getRootAccounts();
    }

    // Fallback
    return await Account.find({
      parentAccount: null,
      isActive: true,
    })
      .sort({ accountCode: 1 })
      .lean();
  }

  /**
   * Search accounts
   */
  static async searchAccounts(searchTerm) {
    await dbConnect();

    return await Account.find({
      isActive: true,
      $or: [
        { accountCode: { $regex: searchTerm, $options: "i" } },
        { accountName: { $regex: searchTerm, $options: "i" } },
      ],
    })
      .sort({ accountCode: 1 })
      .limit(50)
      .lean();
  }

  /**
   * Check if account has transactions
   */
  static async hasTransactions(accountId) {
    await dbConnect();

    const count = await JournalEntry.countDocuments({
      "lines.accountId": accountId,
    });

    return count > 0;
  }

  /**
   * Get account summary with statistics
   */
  static async getAccountSummary(accountId, startDate, endDate) {
    await dbConnect();

    const account = await Account.findById(accountId);
    if (!account) throw new Error("Account not found");

    const dateFilter = {};
    if (startDate) dateFilter.$gte = new Date(startDate);
    if (endDate) dateFilter.$lte = new Date(endDate);

    const query = {
      status: "posted",
      "lines.accountId": accountId,
    };

    if (Object.keys(dateFilter).length > 0) {
      query.entryDate = dateFilter;
    }

    const result = await JournalEntry.aggregate([
      { $match: query },
      { $unwind: "$lines" },
      { $match: { "lines.accountId": account._id } },
      {
        $group: {
          _id: null,
          totalDebit: { $sum: "$lines.debit" },
          totalCredit: { $sum: "$lines.credit" },
          transactionCount: { $sum: 1 },
        },
      },
    ]);

    const stats = result[0] || {
      totalDebit: 0,
      totalCredit: 0,
      transactionCount: 0,
    };
    const normalSide = ["asset", "expense"].includes(account.accountType)
      ? "debit"
      : "credit";

    const balance =
      normalSide === "debit"
        ? stats.totalDebit - stats.totalCredit
        : stats.totalCredit - stats.totalDebit;

    return {
      account: {
        _id: account._id,
        accountCode: account.accountCode,
        accountName: account.accountName,
        accountType: account.accountType,
        normalBalanceSide: normalSide,
      },
      statistics: {
        totalDebit: stats.totalDebit,
        totalCredit: stats.totalCredit,
        balance,
        transactionCount: stats.transactionCount,
      },
      period: { startDate, endDate },
    };
  }

  /**
   * Validate account for posting
   */
  static async validateAccountForPosting(accountId) {
    await dbConnect();

    const account = await Account.findById(accountId);
    if (!account) throw new Error("Account not found");
    if (!account.isActive)
      throw new Error(`Account "${account.accountName}" is inactive`);
    if (!account.canPost) {
      throw new Error(
        `Cannot post to header account "${account.accountName}". Select a detail account.`
      );
    }

    return true;
  }

  /**
   * Refresh all balances (maintenance)
   */
  static async refreshAllBalances() {
    await dbConnect();

    const accounts = await Account.find({
      canPost: true,
      isActive: true,
    });

    let updated = 0;

    for (const account of accounts) {
      try {
        await account.calculateActualBalance(); // USE SCHEMA METHOD
        updated++;
      } catch (error) {
        console.error(
          `Failed to refresh ${account.accountCode}:`,
          error.message
        );
      }
    }

    return {
      total: accounts.length,
      updated,
      failed: accounts.length - updated,
    };
  }
}

export default AccountService;
