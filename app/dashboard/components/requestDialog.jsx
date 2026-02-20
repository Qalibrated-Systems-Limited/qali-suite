// ============================================
// REQUEST DIALOG
// ============================================

import Account from "@/app/models/account";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { CreateRequestFromCartForm } from "./createRequestForm";
import { IconClipboardList } from "@tabler/icons-react";

import CreateReqComponent from "./createReqComponent";
export function RequestDialog({ cart, cartTotal, customers = [] }) {
  // Fetch customers (accounts)

  if (customers) {
    customers = customers.map((account) => ({
      name: account.name,
      _id: account._id.toString(),
    }));
  }

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button
          className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
          size="lg"
        >
          <IconClipboardList className="mr-2 h-5 w-5" />
          Create Stock Request
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <IconClipboardList className="h-5 w-5 text-primary" />
            Create Stock Request
          </DialogTitle>
          <DialogDescription>
            Submit a request for these items. A manager will review and approve
            before dispatch.
          </DialogDescription>
        </DialogHeader>

        <CreateReqComponent />
      </DialogContent>
    </Dialog>
  );
}
