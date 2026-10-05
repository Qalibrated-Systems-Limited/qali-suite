import PCScreenStub from "../components/PCScreenStub";

export const metadata = { title: "Completed work | Projects" };

export default function Page() {
  return (
    <PCScreenStub
      title="Completed work"
      blurb="Projects that have been closed out — their final accounts, retention clocks and the record of how they finished."
      related={{ href: "/dashboard/projects", label: "Open the projects register" }}
    />
  );
}
