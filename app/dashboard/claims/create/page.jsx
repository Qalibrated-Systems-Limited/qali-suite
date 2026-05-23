import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { 
  ArrowLeft, 
  DollarSign, 
  Receipt, 
  Calendar,
  MapPin,
  FileText,
  ChevronRight,
} from "lucide-react";

export const metadata = {
  title: "Create Claim | ERP System",
  description: "Choose claim type to get started",
};

export default async function CreateClaimPage() {
  const session = await auth();

  if (!session?.user) {
    redirect("/login");
  }

  return (
    <div className="flex flex-col gap-6 sm:gap-8 p-4 sm:p-6 lg:p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 sm:gap-4">
        <Button
          variant="ghost"
          size="icon"
          asChild
          className="hover:bg-accent flex-shrink-0"
        >
          <Link href="/dashboard/my-claims">
            <ArrowLeft className="w-5 h-5" />
          </Link>
        </Button>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-foreground truncate">
            Create New Claim
          </h1>
          <p className="text-xs sm:text-sm text-muted-foreground mt-1">
            Choose the type of expense claim you want to submit
          </p>
        </div>
      </div>

      {/* Claim Type Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
        {/* Advance Request Card */}
        <Link href="/dashboard/claims/create/advance">
          <Card className="p-6 sm:p-8 hover:shadow-lg hover:border-yellow-500/50 transition-all duration-200 cursor-pointer group h-full">
            <div className="flex flex-col h-full">
              {/* Icon */}
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-purple-100 dark:bg-purple-900/30 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <DollarSign className="w-8 h-8 sm:w-10 sm:h-10 text-purple-600 dark:text-purple-400" />
              </div>

              {/* Content */}
              <div className="flex-1 space-y-3 sm:space-y-4">
                <div>
                  <h3 className="text-xl sm:text-2xl font-bold text-foreground mb-2 group-hover:text-yellow-600 transition-colors">
                    Advance Request
                  </h3>
                  <p className="text-sm sm:text-base text-muted-foreground">
                    Request money in advance for upcoming business expenses like travel, accommodation, or client visits.
                  </p>
                </div>

                {/* Features */}
                <ul className="space-y-2 text-sm sm:text-base">
                  <li className="flex items-start gap-3">
                    <Calendar className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">For future expenses</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <MapPin className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">Travel & accommodation</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <Receipt className="w-5 h-5 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">Settle with receipts after trip</span>
                  </li>
                </ul>
              </div>

              {/* Button */}
              <div className="mt-6 pt-6 border-t border-border">
                <div className="flex items-center justify-between">
                  <span className="text-sm sm:text-base font-semibold text-yellow-600 dark:text-yellow-400">
                    Request Advance
                  </span>
                  <ChevronRight className="w-5 h-5 text-yellow-600 dark:text-yellow-400 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </div>
          </Card>
        </Link>

        {/* Reimbursement Card */}
        <Link href="/dashboard/claims/create/reimbursement">
          <Card className="p-6 sm:p-8 hover:shadow-lg hover:border-yellow-500/50 transition-all duration-200 cursor-pointer group h-full">
            <div className="flex flex-col h-full">
              {/* Icon */}
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-2xl bg-teal-100 dark:bg-teal-900/30 flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Receipt className="w-8 h-8 sm:w-10 sm:h-10 text-teal-600 dark:text-teal-400" />
              </div>

              {/* Content */}
              <div className="flex-1 space-y-3 sm:space-y-4">
                <div>
                  <h3 className="text-xl sm:text-2xl font-bold text-foreground mb-2 group-hover:text-yellow-600 transition-colors">
                    Reimbursement Claim
                  </h3>
                  <p className="text-sm sm:text-base text-muted-foreground">
                    Request reimbursement for business expenses you've already paid from your own pocket.
                  </p>
                </div>

                {/* Features */}
                <ul className="space-y-2 text-sm sm:text-base">
                  <li className="flex items-start gap-3">
                    <Receipt className="w-5 h-5 text-teal-600 dark:text-teal-400 flex-shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">For past expenses</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <FileText className="w-5 h-5 text-teal-600 dark:text-teal-400 flex-shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">Submit with receipts</span>
                  </li>
                  <li className="flex items-start gap-3">
                    <DollarSign className="w-5 h-5 text-teal-600 dark:text-teal-400 flex-shrink-0 mt-0.5" />
                    <span className="text-muted-foreground">Get reimbursed to your account</span>
                  </li>
                </ul>
              </div>

              {/* Button */}
              <div className="mt-6 pt-6 border-t border-border">
                <div className="flex items-center justify-between">
                  <span className="text-sm sm:text-base font-semibold text-yellow-600 dark:text-yellow-400">
                    Submit Claim
                  </span>
                  <ChevronRight className="w-5 h-5 text-yellow-600 dark:text-yellow-400 group-hover:translate-x-1 transition-transform" />
                </div>
              </div>
            </div>
          </Card>
        </Link>
      </div>

      {/* Help Card */}
      <Card className="p-5 sm:p-6 bg-muted/50">
        <h4 className="font-semibold text-sm sm:text-base mb-3">💡 Need help choosing?</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm sm:text-base text-muted-foreground">
          <div>
            <p className="font-medium text-foreground mb-2">Choose Advance Request if:</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>You need money before traveling</li>
              <li>The expense hasn't happened yet</li>
              <li>You'll provide receipts after</li>
            </ul>
          </div>
          <div>
            <p className="font-medium text-foreground mb-2">Choose Reimbursement if:</p>
            <ul className="space-y-1 list-disc list-inside">
              <li>You already paid from your pocket</li>
              <li>You have receipts ready</li>
              <li>You want to get refunded</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}