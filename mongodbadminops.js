const { dbConnect } = require("./app/config/dbConnect");
const { default: Party } = require("./app/models/parties");
const { User } = require("./app/models/user");

const { Product } = require("./app/models/product.js");

const { default: Category } = require("./app/models/category");
const { default: Company } = require("./app/models/Company");

//69928a1d3ed64708a0c34da5

async function deleteNonCompanyVehicles() {
  try {
    await dbConnect();
    console.log("Connected to MongoDB");

    // Find all non-company vehicles
    const nonCompanyVehicles = await Product.updateMany(
      {},
      { companyId: "6992ed1723d69e99fb45b5ba" },
    );

    console.log(nonCompanyVehicles);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

/**
 * Generate company codes for companies that don't have one
 * Creates codes from company name initials (e.g., "Acme Trading Ltd" -> "ATL")
 */
async function generateCompanyCodes() {
  try {
    await dbConnect();
    console.log("Connected to MongoDB");

    // Find companies without a code
    const companies = await Company.find({ code: { $exists: false } });
    console.log(`Found ${companies.length} companies without codes`);

    const usedCodes = new Set();
    // Get existing codes
    const existingCodes = await Company.find({
      code: { $exists: true },
    }).select("code");
    existingCodes.forEach((c) => usedCodes.add(c.code));

    for (const company of companies) {
      // Generate code from company name initials
      let code = company.name
        .split(/\s+/)
        .map((word) => word[0])
        .join("")
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, "")
        .slice(0, 6);

      // Ensure minimum 2 chars
      if (code.length < 2) {
        code = company.name
          .toUpperCase()
          .replace(/[^A-Z0-9]/g, "")
          .slice(0, 4);
      }

      // Ensure uniqueness
      let finalCode = code;
      let suffix = 1;
      while (usedCodes.has(finalCode)) {
        finalCode = `${code.slice(0, 4)}${suffix}`;
        suffix++;
      }
      usedCodes.add(finalCode);

      console.log(`  ${company.name} -> ${finalCode}`);

      // Update company with new code (bypass validation temporarily)
      await Company.updateOne(
        { _id: company._id },
        { $set: { code: finalCode } },
      );
    }

    console.log("\n✓ Company codes generated successfully!");
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

// Run the function you need:
// deleteNonCompanyVehicles();
//deleteNonCompanyVehicles();
