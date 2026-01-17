// app/(dashboard)/bills/BillListClient.jsx
// "use client";

// import { useState, useTransition } from "react";
// import Link from "next/link";
// import { useRouter } from "next/navigation";
// import { format } from "date-fns";
// import {
//   Eye,
//   Edit,
//   Trash2,
//   MoreHorizontal,
//   CheckCircle,
//   XCircle,
//   Send,
//   FileText,
//   Building2,
//   Calendar,
//   CreditCard,
//   Clock,
//   AlertCircle,
// } from "lucide-react";
// import { Button } from "@/components/ui/button";
// import {
//   DropdownMenu,
//   DropdownMenuContent,
//   DropdownMenuItem,
//   DropdownMenuSeparator,
//   DropdownMenuTrigger,
// } from "@/components/ui/dropdown-menu";
// import {
//   AlertDialog,
//   AlertDialogAction,
//   AlertDialogCancel,
//   AlertDialogContent,
//   AlertDialogDescription,
//   AlertDialogFooter,
//   AlertDialogHeader,
//   AlertDialogTitle,
// } from "@/components/ui/alert-dialog";
// import { toast } from "sonner";
// import {
//   deleteBill,
//   submitBillForApproval,
//   approveBill,
// } from "../../../mongodb/actions/bill-actions";

// // ============================================
// // HELPERS
// // ============================================

// function formatDate(date) {
//   if (!date) return "-";
//   return format(new Date(date), "dd MMM yyyy");
// }

// // ============================================
// // STATUS BADGE
// // ============================================
// function StatusBadge({ status }) {
//   const config = {
//     draft: {
//       label: "Draft",
//       className: "bg-zinc-500/10 text-zinc-600 dark:text-zinc-400",
//     },
//     pending: {
//       label: "Pending",
//       className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
//     },
//     approved: {
//       label: "Approved",
//       className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
//     },
//     rejected: {
//       label: "Rejected",
//       className: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
//     },
//     cancelled: {
//       label: "Cancelled",
//       className: "bg-zinc-500/10 text-zinc-500",
//     },
//   };

//   const { label, className } = config[status] || config.draft;

//   return (
//     <span
//       className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}
//     >
//       {label}
//     </span>
//   );
// }

// // ============================================
// // PAYMENT STATUS BADGE
// // ============================================
// function PaymentBadge({ status }) {
//   const config = {
//     unpaid: {
//       label: "Unpaid",
//       className: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
//     },
//     partial: {
//       label: "Partial",
//       className: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
//     },
//     paid: {
//       label: "Paid",
//       className: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
//     },
//   };

//   const { label, className } = config[status] || config.unpaid;

//   return (
//     <span
//       className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}
//     >
//       {label}
//     </span>
//   );
// }

// // ============================================
// // EMPTY STATE
// // ============================================
// function EmptyState() {
//   return (
//     <div className="rounded-lg border border-dashed bg-muted/30 p-12 text-center">
//       <FileText className="h-12 w-12 text-muted-foreground/50 mx-auto mb-4" />
//       <h3 className="text-lg font-medium mb-1">No bills found</h3>
//       <p className="text-sm text-muted-foreground mb-4">
//         Get started by creating your first bill
//       </p>
//       <Button asChild>
//         <Link href="/bills/new">Create Bill</Link>
//       </Button>
//     </div>
//   );
// }

// // ============================================
// // MOBILE CARD
// // ============================================
// function BillCard({ bill, onAction, isPending }) {
//   const isOverdue =
//     bill.paymentStatus !== "paid" &&
//     bill.dueDate &&
//     new Date(bill.dueDate) < new Date();

//   return (
//     <div className="rounded-lg border bg-card p-4 space-y-3">
//       {/* Header */}
//       <div className="flex items-start justify-between gap-2">
//         <div className="min-w-0 flex-1">
//           <Link
//             href={`/bills/${bill._id}`}
//             className="font-medium hover:text-primary transition-colors"
//           >
//             {bill.billNumber}
//           </Link>
//           {bill.supplierInvoiceNumber && (
//             <p className="text-xs text-muted-foreground truncate">
//               Ref: {bill.supplierInvoiceNumber}
//             </p>
//           )}
//         </div>
//         <div className="flex items-center gap-2">
//           <StatusBadge status={bill.status} />
//           <DropdownMenu>
//             <DropdownMenuTrigger asChild>
//               <Button variant="ghost" size="icon" className="h-8 w-8">
//                 <MoreHorizontal className="h-4 w-4" />
//               </Button>
//             </DropdownMenuTrigger>
//             <DropdownMenuContent align="end">
//               <DropdownMenuItem asChild>
//                 <Link href={`/bills/${bill._id}`}>
//                   <Eye className="h-4 w-4 mr-2" />
//                   View
//                 </Link>
//               </DropdownMenuItem>
//               {bill.status === "draft" && (
//                 <>
//                   <DropdownMenuItem asChild>
//                     <Link href={`/bills/${bill._id}/edit`}>
//                       <Edit className="h-4 w-4 mr-2" />
//                       Edit
//                     </Link>
//                   </DropdownMenuItem>
//                   <DropdownMenuItem
//                     onClick={() => onAction("submit", bill)}
//                     disabled={isPending}
//                   >
//                     <Send className="h-4 w-4 mr-2" />
//                     Submit for Approval
//                   </DropdownMenuItem>
//                   <DropdownMenuSeparator />
//                   <DropdownMenuItem
//                     onClick={() => onAction("delete", bill)}
//                     disabled={isPending}
//                     className="text-destructive focus:text-destructive"
//                   >
//                     <Trash2 className="h-4 w-4 mr-2" />
//                     Delete
//                   </DropdownMenuItem>
//                 </>
//               )}
//               {bill.status === "pending" && (
//                 <DropdownMenuItem
//                   onClick={() => onAction("approve", bill)}
//                   disabled={isPending}
//                 >
//                   <CheckCircle className="h-4 w-4 mr-2" />
//                   Approve
//                 </DropdownMenuItem>
//               )}
//             </DropdownMenuContent>
//           </DropdownMenu>
//         </div>
//       </div>

//       {/* Supplier */}
//       <div className="flex items-center gap-2 text-sm">
//         <Building2 className="h-4 w-4 text-muted-foreground flex-shrink-0" />
//         <span className="truncate">{bill.supplier?.name || "Unknown"}</span>
//       </div>

//       {/* Dates */}
//       <div className="grid grid-cols-2 gap-2 text-sm">
//         <div className="flex items-center gap-2">
//           <Calendar className="h-4 w-4 text-muted-foreground flex-shrink-0" />
//           <span>{formatDate(bill.billDate)}</span>
//         </div>
//         <div
//           className={`flex items-center gap-2 ${
//             isOverdue ? "text-rose-500" : ""
//           }`}
//         >
//           <Clock className="h-4 w-4 flex-shrink-0" />
//           <span>Due {formatDate(bill.dueDate)}</span>
//         </div>
//       </div>

//       {/* Footer */}
//       <div className="flex items-center justify-between pt-2 border-t">
//         <PaymentBadge status={bill.paymentStatus} />
//         <div className="text-right">
//           <p className="text-lg font-semibold">
//             {formatCurrency(bill.amounts?.total)}
//           </p>
//           {bill.amounts?.balance > 0 &&
//             bill.amounts?.balance !== bill.amounts?.total && (
//               <p className="text-xs text-muted-foreground">
//                 Balance: {formatCurrency(bill.amounts?.balance)}
//               </p>
//             )}
//         </div>
//       </div>
//     </div>
//   );
// }

// // ============================================
// // DESKTOP TABLE ROW
// // ============================================
// function BillTableRow({ bill, onAction, isPending }) {
//   const isOverdue =
//     bill.paymentStatus !== "paid" &&
//     bill.dueDate &&
//     new Date(bill.dueDate) < new Date();

//   return (
//     <tr className="border-b hover:bg-muted/50 transition-colors">
//       <td className="px-4 py-3">
//         <div>
//           <Link
//             href={`/bills/${bill._id}`}
//             className="font-medium hover:text-primary transition-colors"
//           >
//             {bill.billNumber}
//           </Link>
//           {bill.supplierInvoiceNumber && (
//             <p className="text-xs text-muted-foreground">
//               Ref: {bill.supplierInvoiceNumber}
//             </p>
//           )}
//         </div>
//       </td>
//       <td className="px-4 py-3">
//         <span className="truncate">{bill.supplier?.name || "Unknown"}</span>
//       </td>
//       <td className="px-4 py-3 text-sm">{formatDate(bill.billDate)}</td>
//       <td
//         className={`px-4 py-3 text-sm ${
//           isOverdue ? "text-rose-500 font-medium" : ""
//         }`}
//       >
//         {formatDate(bill.dueDate)}
//         {isOverdue && <AlertCircle className="h-3 w-3 inline ml-1" />}
//       </td>
//       <td className="px-4 py-3">
//         <StatusBadge status={bill.status} />
//       </td>
//       <td className="px-4 py-3">
//         <PaymentBadge status={bill.paymentStatus} />
//       </td>
//       <td className="px-4 py-3 text-right font-medium">
//         {formatCurrency(bill.amounts?.total)}
//         {bill.amounts?.balance > 0 &&
//           bill.amounts?.balance !== bill.amounts?.total && (
//             <p className="text-xs text-muted-foreground font-normal">
//               Bal: {formatCurrency(bill.amounts?.balance)}
//             </p>
//           )}
//       </td>
//       <td className="px-4 py-3">
//         <DropdownMenu>
//           <DropdownMenuTrigger asChild>
//             <Button variant="ghost" size="icon" className="h-8 w-8">
//               <MoreHorizontal className="h-4 w-4" />
//             </Button>
//           </DropdownMenuTrigger>
//           <DropdownMenuContent align="end">
//             <DropdownMenuItem asChild>
//               <Link href={`/bills/${bill._id}`}>
//                 <Eye className="h-4 w-4 mr-2" />
//                 View Details
//               </Link>
//             </DropdownMenuItem>
//             {bill.status === "draft" && (
//               <>
//                 <DropdownMenuItem asChild>
//                   <Link href={`/bills/${bill._id}/edit`}>
//                     <Edit className="h-4 w-4 mr-2" />
//                     Edit
//                   </Link>
//                 </DropdownMenuItem>
//                 <DropdownMenuItem
//                   onClick={() => onAction("submit", bill)}
//                   disabled={isPending}
//                 >
//                   <Send className="h-4 w-4 mr-2" />
//                   Submit for Approval
//                 </DropdownMenuItem>
//                 <DropdownMenuSeparator />
//                 <DropdownMenuItem
//                   onClick={() => onAction("delete", bill)}
//                   disabled={isPending}
//                   className="text-destructive focus:text-destructive"
//                 >
//                   <Trash2 className="h-4 w-4 mr-2" />
//                   Delete
//                 </DropdownMenuItem>
//               </>
//             )}
//             {bill.status === "pending" && (
//               <DropdownMenuItem
//                 onClick={() => onAction("approve", bill)}
//                 disabled={isPending}
//               >
//                 <CheckCircle className="h-4 w-4 mr-2" />
//                 Approve
//               </DropdownMenuItem>
//             )}
//           </DropdownMenuContent>
//         </DropdownMenu>
//       </td>
//     </tr>
//   );
// }

// // ============================================
// // MAIN COMPONENT
// // ============================================
// export default function BillListClient({ bills }) {
//   const router = useRouter();
//   const [isPending, startTransition] = useTransition();
//   const [deleteDialog, setDeleteDialog] = useState({ open: false, bill: null });

//   // ----------------------------------------
//   // HANDLERS
//   // ----------------------------------------
//   const handleAction = (action, bill) => {
//     switch (action) {
//       case "delete":
//         setDeleteDialog({ open: true, bill });
//         break;
//       case "submit":
//         handleSubmit(bill._id);
//         break;
//       case "approve":
//         handleApprove(bill._id);
//         break;
//     }
//   };

//   const handleDelete = () => {
//     if (!deleteDialog.bill) return;

//     startTransition(async () => {
//       const result = await deleteBill(deleteDialog.bill._id);

//       if (result.success) {
//         toast.success("Bill deleted successfully");
//         router.refresh();
//       } else {
//         toast.error(result.error || "Failed to delete bill");
//       }

//       setDeleteDialog({ open: false, bill: null });
//     });
//   };

//   const handleSubmit = (id) => {
//     startTransition(async () => {
//       const result = await submitBillForApproval(id);

//       if (result.success) {
//         toast.success("Bill submitted for approval");
//         router.refresh();
//       } else {
//         toast.error(result.error || "Failed to submit bill");
//       }
//     });
//   };

//   const handleApprove = (id) => {
//     startTransition(async () => {
//       const result = await approveBill(id);

//       if (result.success) {
//         toast.success("Bill approved successfully");
//         router.refresh();
//       } else {
//         toast.error(result.error || "Failed to approve bill");
//       }
//     });
//   };

//   // ----------------------------------------
//   // RENDER
//   // ----------------------------------------
//   if (!bills || bills.length === 0) {
//     return <EmptyState />;
//   }

//   return (
//     <>
//       {/* Mobile: Cards */}
//       <div className="grid gap-3 md:hidden">
//         {bills.map((bill) => (
//           <BillCard
//             key={bill._id}
//             bill={bill}
//             onAction={handleAction}
//             isPending={isPending}
//           />
//         ))}
//       </div>

//       {/* Desktop: Table */}
//       <div className="hidden md:block rounded-lg border bg-card overflow-hidden">
//         <div className="overflow-x-auto">
//           <table className="w-full">
//             <thead className="bg-muted/50 border-b">
//               <tr>
//                 <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
//                   Bill #
//                 </th>
//                 <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
//                   Supplier
//                 </th>
//                 <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
//                   Date
//                 </th>
//                 <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
//                   Due Date
//                 </th>
//                 <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
//                   Status
//                 </th>
//                 <th className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider">
//                   Payment
//                 </th>
//                 <th className="px-4 py-3 text-right text-xs font-medium text-muted-foreground uppercase tracking-wider">
//                   Amount
//                 </th>
//                 <th className="px-4 py-3 w-12"></th>
//               </tr>
//             </thead>
//             <tbody className="divide-y">
//               {bills.map((bill) => (
//                 <BillTableRow
//                   key={bill._id}
//                   bill={bill}
//                   onAction={handleAction}
//                   isPending={isPending}
//                 />
//               ))}
//             </tbody>
//           </table>
//         </div>
//       </div>

//       {/* Delete Confirmation Dialog */}
//       <AlertDialog
//         open={deleteDialog.open}
//         onOpenChange={(open) => setDeleteDialog({ open, bill: null })}
//       >
//         <AlertDialogContent>
//           <AlertDialogHeader>
//             <AlertDialogTitle>Delete Bill?</AlertDialogTitle>
//             <AlertDialogDescription>
//               Are you sure you want to delete bill{" "}
//               <span className="font-medium">
//                 {deleteDialog.bill?.billNumber}
//               </span>
//               ? This action cannot be undone.
//             </AlertDialogDescription>
//           </AlertDialogHeader>
//           <AlertDialogFooter>
//             <AlertDialogCancel disabled={isPending}>Cancel</AlertDialogCancel>
//             <AlertDialogAction
//               onClick={handleDelete}
//               disabled={isPending}
//               className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
//             >
//               {isPending ? "Deleting..." : "Delete"}
//             </AlertDialogAction>
//           </AlertDialogFooter>
//         </AlertDialogContent>
//       </AlertDialog>
//     </>
//   );
// }
