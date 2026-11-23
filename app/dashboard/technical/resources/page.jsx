import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getResourceRequests, getResourceOptions } from "@/app/db/actions/resource-actions";
import ResourcesBoard from "./ResourcesBoard";

export const metadata = {
  title: "Resources | Technical",
  description: "Technicians, vehicles and equipment — requested for work, approved by the technical manager",
};

/**
 * Technicians, vehicles and test equipment are requested for a piece of work
 * and approved by the technical manager, who sees whether each is free.
 * Anyone can ask (help desk, projects, contracts); the link from a ticket or a
 * contract arrives with the source filled in (?source=…&sourceId=…&ref=…).
 */
export default async function ResourcesPage({ searchParams }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const sp = (await searchParams) || {};
  const [data, options] = await Promise.all([getResourceRequests(), getResourceOptions()]);
  const prefill = {
    sourceType: typeof sp.source === "string" ? sp.source : "",
    sourceId: typeof sp.sourceId === "string" ? sp.sourceId : "",
    sourceRef: typeof sp.ref === "string" ? sp.ref : "",
    sourceTitle: typeof sp.title === "string" ? sp.title : "",
    resourceType: typeof sp.type === "string" ? sp.type : "technician",
  };
  return (
    <div className="tech-wrap">
      <ResourcesBoard
        me={data.me}
        requests={data.requests}
        availability={data.availability}
        options={options}
        prefill={prefill}
        openForm={Boolean(sp.source || sp.new)}
      />
    </div>
  );
}
