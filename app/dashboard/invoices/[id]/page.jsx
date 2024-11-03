import ItemsTable from "./table";

import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "../../../../components/ui/card";

import ReactPDF from "@react-pdf/renderer";

import Invoice from "../../../models/invoice";
import { notFound } from "next/navigation";
import { format } from "date-fns";
import Link from "next/link";
import { PrinterIcon } from "lucide-react";
import { GeneratePdf } from "./download";
import InvoiceDetails from "../../components/invoice-details";
import { Suspense } from "react";
import { InvoiceDetailsSkeleton } from "../../components/invoice-detail-skeleton";

async function page(props) {
  const params = await props.params;
  const id = params.id;

  return (
    <Suspense fallback={<InvoiceDetailsSkeleton />}>
      <InvoiceDetails id={id} />;
    </Suspense>
  );
}

export default page;
