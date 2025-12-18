import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card";
import { Skeleton } from "../../../../components/ui/skeleton";
import InvoicesLoadingCompact from "../components/InvoiceLoadingSkeleton";

export default function Loading() {
  return <InvoicesLoadingCompact />;
}
