import PartyForm from "../components/partyForm";

export const metadata = {
  title: "Create Party | ERP System",
  description: "Create a new customer, supplier, or employee",
};

export default async function CreatePartyPage({ searchParams }) {
  const params = await searchParams;
  const lockedType = params?.type || null;

  // Validate type if provided
  const validTypes = ["customer", "supplier", "employee", "both"];
  const type = validTypes.includes(lockedType) ? lockedType : null;

  return <PartyForm lockedType={type} />;
}
