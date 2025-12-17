import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card";
import { Skeleton } from "../../../../components/ui/skeleton";
import { UsersPageSkeleton } from "../components/UserSkeleton";

export default function Loading() {
  return <UsersPageSkeleton />;
}
