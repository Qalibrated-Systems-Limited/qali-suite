import dbConnect from "./app/config/dbConnect.js";
import Vehicle from "./app/models/vehicles.js";

async function deleteNonCompanyVehicles() {
  try {
    await dbConnect();
    console.log("Connected to MongoDB");

    // Find all non-company vehicles
    const nonCompanyVehicles = await Vehicle.find({ isCompanyVehicle: { $ne: true } });

    console.log(`Found ${nonCompanyVehicles.length} non-company vehicles to delete:`);
    nonCompanyVehicles.forEach((v) => {
      console.log(`  - ${v.numberPlate} (isCompanyVehicle: ${v.isCompanyVehicle})`);
    });

    if (nonCompanyVehicles.length === 0) {
      console.log("No non-company vehicles to delete.");
      process.exit(0);
    }

    // Delete them
    const result = await Vehicle.deleteMany({ isCompanyVehicle: { $ne: true } });
    console.log(`\nDeleted ${result.deletedCount} non-company vehicles.`);

    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

deleteNonCompanyVehicles();
