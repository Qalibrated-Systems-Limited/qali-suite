import React from "react";

import UpdateForm from "./updateForm";
import { SettingsForm } from "./form";
import { getWbConfigs } from "../../mongodb/queries/queries";
import { auth } from "../../../auth";

async function page() {
  const sesssion = await auth();
  const user = sesssion && sesssion.user;

  if (user.role !== "Admin") {
    return (
      <div className="flex h-full items-center justify-center gap-3">
        <h1 className="font-semibold text-red-400">Not Authorized </h1>
      </div>
    );
  }
  const weighbridgeConfigs = await getWbConfigs("WB/FEED/001");

  let settings = {};
  if (weighbridgeConfigs) {
    settings = {
      isLocked: weighbridgeConfigs.isLocked,
      weigherId: weighbridgeConfigs.weigherId,
      maxCapacity: weighbridgeConfigs.maxCapacity,
      minCapacity: weighbridgeConfigs.minCapacity,
      division: weighbridgeConfigs.division,
      _id: weighbridgeConfigs._id.toString(),
    };
  }

  return weighbridgeConfigs && weighbridgeConfigs._id ? (
    <UpdateForm settings={settings} />
  ) : (
    <SettingsForm />
  );
}

export default page;
