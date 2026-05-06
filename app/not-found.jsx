import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import Link from "next/link";
import { FileQuestion, Home, ArrowLeft, Search } from "lucide-react";
import GoBackButton from "@/components/createButton";

export default function NotFound() {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-2xl w-full bg-card border-border">
        <CardContent className="pt-6">
          {/* 404 Icon */}
          <div className="flex justify-center mb-6">
            <div className="w-20 h-20 bg-yellow-500/10 rounded-full flex items-center justify-center">
              <FileQuestion className="w-10 h-10 text-yellow-600 dark:text-yellow-400" />
            </div>
          </div>

          {/* 404 Number */}
          <div className="text-center mb-6">
            <h1 className="text-9xl font-bold text-yellow-500 mb-2">404</h1>
            <div className="w-24 h-1 bg-yellow-500 mx-auto rounded-full"></div>
          </div>

          {/* Error Message */}
          <div className="text-center space-y-4 mb-8">
            <h2 className="text-2xl font-bold text-foreground">
              Page Not Found
            </h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Sorry, we couldn't find the page you're looking for. The page may
              have been moved, deleted, or never existed.
            </p>
          </div>

          {/* Suggestions */}
          <div className="mb-8 p-4 bg-muted/50 rounded-lg border border-border">
            <p className="text-sm text-foreground font-medium mb-3">
              Here are some helpful links instead:
            </p>
            <ul className="space-y-2 text-sm text-muted-foreground">
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full"></span>
                Check the URL for typos
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full"></span>
                Go back to the previous page
              </li>
              <li className="flex items-center gap-2">
                <span className="w-1.5 h-1.5 bg-yellow-500 rounded-full"></span>
                Visit the dashboard to find what you need
              </li>
            </ul>
          </div>

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              className="bg-yellow-500 hover:bg-yellow-600 text-black font-medium"
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
              asChild
            >
              <Link href="/dashboard/stocks">
                <Search className="mr-2 h-4 w-4" />
                Browse Stock
              </Link>
            </Button>
            <GoBackButton />
          </div>

          <div className="mt-8 text-center">
            <p className="text-xs text-muted-foreground">
              If you got here from a link in the app, please report it.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
