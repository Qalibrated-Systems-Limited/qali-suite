import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card";
import { Skeleton } from "../../../../components/ui/skeleton";
import DeliveryNotesLoading from "../components/DnoteLoadingSkeleton";

export default function Loading() {
  return <DeliveryNotesLoading />;
}
