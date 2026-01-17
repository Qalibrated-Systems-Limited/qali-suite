import { getClaimStats } from "@/app/mongodb/queries/claimQueries";
import { Card } from "@/components/ui/card";
import { formatCurrency } from "@/lib/utils";
import { CheckCircle2 } from "lucide-react";
import { Clock } from "lucide-react";
import { DollarSign } from "lucide-react";
import React from "react";

async function ClaimStats({ userId = null, userRole = null }) {
  const stats = await getClaimStats(userId, userRole);
  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        {/* Total Claims */}
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-900/30">
                <DollarSign className="w-5 h-5 sm:w-6 sm:h-6 text-blue-600 dark:text-blue-400" />
              </div>
            </div>
            <div>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Total Claims
              </p>
              <p className="text-2xl sm:text-3xl font-bold text-foreground">
                {stats.total}
              </p>
            </div>
          </div>
        </Card>

        {/* Pending Approval */}
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-yellow-100 dark:bg-yellow-900/30">
                <Clock className="w-5 h-5 sm:w-6 sm:h-6 text-yellow-600 dark:text-yellow-400" />
              </div>
            </div>
            <div>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Pending
              </p>
              <p className="text-2xl sm:text-3xl font-bold text-foreground">
                {stats.pending}
              </p>
            </div>
          </div>
        </Card>

        {/* Approved */}
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-green-100 dark:bg-green-900/30">
                <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <div>
              <p className="text-xs sm:text-sm text-muted-foreground">
                Approved
              </p>
              <p className="text-2xl sm:text-3xl font-bold text-foreground">
                {stats.approved}
              </p>
            </div>
          </div>
        </Card>

        {/* Paid */}
        <Card className="p-4 sm:p-5">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/30">
                <CheckCircle2 className="w-5 h-5 sm:w-6 sm:h-6 text-purple-600 dark:text-purple-400" />
              </div>
            </div>
            <div>
              <p className="text-xs sm:text-sm text-muted-foreground">Paid</p>
              <p className="text-2xl sm:text-3xl font-bold text-foreground">
                {stats.paid}
              </p>
            </div>
          </div>
        </Card>
      </div>

      {/* Amount Summary Card */}
      <Card className="p-5 sm:p-6 bg-gradient-to-br from-yellow-50 to-orange-50 dark:from-yellow-900/20 dark:to-orange-900/20 border-yellow-200 dark:border-yellow-800">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-5 sm:gap-6">
          <div className="space-y-2">
            <p className="text-xs sm:text-sm text-muted-foreground font-medium">
              Pending Amount
            </p>
            <p className="text-xl sm:text-2xl font-bold text-yellow-700 dark:text-yellow-400">
              {formatCurrency(stats.totalPendingAmount)}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-xs sm:text-sm text-muted-foreground font-medium">
              Approved Amount
            </p>
            <p className="text-xl sm:text-2xl font-bold text-green-700 dark:text-green-400">
              {formatCurrency(stats.totalApprovedAmount)}
            </p>
          </div>
          <div className="space-y-2">
            <p className="text-xs sm:text-sm text-muted-foreground font-medium">
              Paid Amount
            </p>
            <p className="text-xl sm:text-2xl font-bold text-purple-700 dark:text-purple-400">
              {formatCurrency(stats.totalPaidAmount)}
            </p>
          </div>
        </div>
      </Card>
    </>
  );
}

export default ClaimStats;
