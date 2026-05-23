"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RotateCcw, AlertTriangle, Receipt } from "lucide-react";
import { ReturnDialog } from "../components/ReturnDialog";
import { EscalateDialog } from "../components/EscalateDialog";
import { ExpenseInternalDialog } from "../components/ExpenseInternalDialog";

export function CheckoutActions({
  checkout,
  canReturn,
  canEscalate,
  canExpense,
  expenseAccounts = [],
}) {
  const [returnOpen, setReturnOpen] = useState(false);
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [expenseOpen, setExpenseOpen] = useState(false);

  if (!canReturn && !canEscalate && !canExpense) return null;

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {canReturn && (
          <Button
            onClick={() => setReturnOpen(true)}
            className="bg-green-500 hover:bg-green-600 text-white"
            size="sm"
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            Process Return
          </Button>
        )}
        {canEscalate && (
          <Button
            onClick={() => setEscalateOpen(true)}
            variant="outline"
            size="sm"
            className="border-red-500/20 text-red-500 hover:bg-red-500/10"
          >
            <AlertTriangle className="mr-2 h-4 w-4" />
            Escalate
          </Button>
        )}
        {canExpense && (
          <Button
            onClick={() => setExpenseOpen(true)}
            variant="outline"
            size="sm"
            className="border-purple-500/20 text-purple-500 hover:bg-purple-500/10"
          >
            <Receipt className="mr-2 h-4 w-4" />
            Expense Item
          </Button>
        )}
      </div>

      <ReturnDialog
        checkout={checkout}
        open={returnOpen}
        onOpenChange={setReturnOpen}
      />
      <EscalateDialog
        checkout={checkout}
        open={escalateOpen}
        onOpenChange={setEscalateOpen}
      />
      <ExpenseInternalDialog
        checkout={checkout}
        expenseAccounts={expenseAccounts}
        open={expenseOpen}
        onOpenChange={setExpenseOpen}
      />
    </>
  );
}
