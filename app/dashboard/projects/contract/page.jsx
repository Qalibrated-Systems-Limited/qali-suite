import PCScreenStub from "../components/PCScreenStub";

export const metadata = { title: "Contract administration | Projects" };

export default function Page() {
  return (
    <PCScreenStub
      title="Contract administration"
      blurb="The contract data taken from your own conditions — form of contract, notice and claim periods, retention, liquidated damages, caps and security expiries — and the register of notices, claims and instructions with the clock each one started."
      related={{ href: "/dashboard/projects/create", label: "Open the project data sheet" }}
    />
  );
}
