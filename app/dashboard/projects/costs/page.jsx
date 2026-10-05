import PCScreenStub from "../components/PCScreenStub";

export const metadata = { title: "Cost lines | Projects" };

export default function Page() {
  return (
    <PCScreenStub
      title="Cost lines"
      blurb="Every cost posted to a project, by budget line and category — what approved requisitions and bills have committed, and what has actually been spent."
      related={{ href: "/dashboard/projects/sealed-budgets", label: "Open Sealed budgets" }}
    />
  );
}
