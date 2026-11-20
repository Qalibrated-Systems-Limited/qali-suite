import { auth } from "@/auth";
import { redirect } from "next/navigation";
import TasksBoard from "./TasksBoard";
import { getTasksData, getMyAssignments } from "@/app/db/actions/tasks-actions";
import { hasRole, TASK_WRITE_ROLES } from "@/lib/utils/role-gates";

export const metadata = {
  title: "Tasks | QaliSuite",
  description: "Assignments across every department — create, assign and track work to done.",
};

// Auth-gated (session headers) — never statically prerendered.
export const dynamic = "force-dynamic";

export default async function TasksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [data, assignments] = await Promise.all([getTasksData(), getMyAssignments()]);
  const canManage = hasRole(session.user, TASK_WRITE_ROLES);

  return (
    <div style={{ padding: "clamp(16px, 2.4vw, 26px)" }}>
      <TasksBoard
        tasks={data.tasks}
        stats={data.stats}
        users={data.users}
        canManage={canManage}
        assignments={assignments}
        currentUserId={String(session.user.id)}
      />
    </div>
  );
}
