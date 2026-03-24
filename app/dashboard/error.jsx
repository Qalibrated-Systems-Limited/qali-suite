"use client";

import { useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, RefreshCw, Home, ArrowLeft } from "lucide-react";
import Link from "next/link";

export default function Error({ error, reset }) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error("Application Error:", error);
  }, [error]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-2xl w-full bg-card border-border">
        <CardContent className="pt-6">
          {/* Error Icon */}
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center">
              <AlertTriangle className="w-10 h-10 text-red-600 dark:text-red-400" />
            </div>
          </div>

          {/* Error Alert */}
          <Alert
            variant="destructive"
            className="bg-red-500/10 border-red-500/20 mb-6"
          >
            <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            <AlertTitle className="text-red-600 dark:text-red-400 font-semibold text-lg">
              Oops! Something went wrong
            </AlertTitle>
            <AlertDescription className="text-red-600 dark:text-red-400 mt-2">
              We encountered an unexpected error. Don't worry, our team has been
              notified and we're working on it.
            </AlertDescription>
          </Alert>

          {/* Error reference — never expose raw error messages */}
          {error?.digest && (
            <p className="text-xs text-center text-muted-foreground mb-6 font-mono">
              Reference: {error.digest}
            </p>
          )}

          {/* Error Message */}
          <div className="text-center space-y-4 mb-8">
            <h2 className="text-2xl font-bold text-foreground">
              Something Went Wrong
            </h2>
            <p className="text-muted-foreground">
              The page you were trying to view encountered an error. This could
              be temporary - try refreshing the page or going back home.
            </p>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              onClick={reset}
              className="bg-yellow-500 hover:bg-yellow-600 text-black font-medium"
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Try Again
            </Button>
            <Button
              variant="outline"
              className="border-border text-foreground hover:bg-accent"
              asChild
            >
              <Link href="/dashboard">
                <Home className="mr-2 h-4 w-4" />
                Go to Dashboard
              </Link>
            </Button>
            <Button
              variant="outline"
              className="border-border text-foreground hover:bg-accent"
              onClick={() => window.history.back()}
            >
              <ArrowLeft className="mr-2 h-4 w-4" />
              Go Back
            </Button>
          </div>

          {/* Help Text */}
          <div className="mt-8 p-4 bg-muted/50 rounded-lg border border-border">
            <p className="text-xs text-muted-foreground text-center">
              If this problem persists, please contact your system administrator
              or use the feedback button to report the issue.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
