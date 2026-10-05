import PCScreenStub from "../components/PCScreenStub";

export const metadata = { title: "Variations and claims | Projects" };

export default function Page() {
  return (
    <PCScreenStub
      title="Variations and claims"
      blurb="A variation changes what the client owes you (a budget amendment changes what you plan to spend). Original contract, approved variations, the revised contract and anything pending a decision."
      related={{ href: "/dashboard/projects/ipc", label: "Open Certificates & payments" }}
    />
  );
}
