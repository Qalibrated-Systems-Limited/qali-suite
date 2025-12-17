import Account from "../../models/account";
import User from "../../models/user";
import { Button } from "../../../components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import { CreateDNoteForm } from "./AddDnoteForm";

export async function DialogDnote() {
  let accounts = await Account.find({}).lean();

  if (accounts) {
    accounts = accounts.map((account) => {
      return { name: account.name, _id: account._id.toString() };
    });
  }
  let technicians = await User.find({}).lean();

  if (technicians) {
    technicians = technicians.map((account) => {
      return { name: account.name, _id: account._id.toString() };
    });
  }
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button className="px-4 py-2 bg-pink-500 text-white rounded hover:bg-pink-600 dark:bg-pink-600 dark:hover:bg-pink-700">
          Dispatch & Clear Cart
        </button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <DialogHeader>
          <DialogTitle>Create Dnote</DialogTitle>
          <DialogDescription>
            Dispatch items by creating this document.You must select technician
            and customer
          </DialogDescription>
        </DialogHeader>

        <CreateDNoteForm customers={accounts} technicians={technicians} />
      </DialogContent>
    </Dialog>
  );
}
