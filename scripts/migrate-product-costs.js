#!/usr/bin/env node
/**
 * One-time migration script to add costing.costPrice to old products
 * Run with: node scripts/migrate-product-costs.js
 */

require("dotenv").config();
const mongoose = require("mongoose");

async function migrateProductCosts() {
  try {
    // Connect to MongoDB using env variable
    const MONGODB_URI = process.env.MONGODB_URI;

    if (!MONGODB_URI) {
      console.error("❌ MONGODB_URI not found in environment variables");
      process.exit(1);
    }

    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(MONGODB_URI);
    console.log("✅ Connected to MongoDB");

    // Define simple Product schema for migration
    const productSchema = new mongoose.Schema({}, { strict: false });
    const Product = mongoose.model("Product", productSchema);

    // Find all products without costing.costPrice
    const productsWithoutCost = await Product.find({
      $or: [
        { "costing.costPrice": { $exists: false } },
        { "costing.costPrice": null },
        { "costing.costPrice": 0 },
      ],
      price: { $gt: 0 }, // Only products with a price set
    });

    console.log(`\nFound ${productsWithoutCost.length} products without cost price\n`);

    if (productsWithoutCost.length === 0) {
      console.log("✨ All products already have cost prices set!");
      await mongoose.connection.close();
      return;
    }

    let updated = 0;
    let skipped = 0;

    for (const product of productsWithoutCost) {
      const oldPrice = product.price;

      if (!oldPrice || oldPrice <= 0) {
        console.log(`⚠️  Skipping ${product.name} - no valid price`);
        skipped++;
        continue;
      }

      // Initialize costing object
      if (!product.costing) {
        product.costing = {};
      }

      // Set cost price to 70% of selling price (default assumption)
      product.costing.costPrice = oldPrice * 0.7;
      product.costing.costingMethod = "average";

      await product.save();

      console.log(
        `✅ ${product.name} (${product.SKU}) - Price: KES ${oldPrice}, Cost: KES ${product.costing.costPrice.toFixed(2)}`
      );
      updated++;
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`📊 Migration Summary:`);
    console.log(`   ✅ Updated: ${updated} products`);
    console.log(`   ⚠️  Skipped: ${skipped} products (no valid price)`);
    console.log(`   💰 All products now have cost prices for accounting`);
    console.log(`${"=".repeat(60)}\n`);

    await mongoose.connection.close();
    console.log("✅ Database connection closed\n");
  } catch (error) {
    console.error("\n❌ Migration failed:", error.message);
    await mongoose.connection.close();
    process.exit(1);
  }
}

// Run migration
migrateProductCosts();
