"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, XCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * FormBanner - Display success/error messages with auto-dismiss
 *
 * Usage in page.jsx:
 * ```jsx
 * import { FormBanner } from "@/components/ui/form-banner";
 *
 * export default function Page({ searchParams }) {
 *   return (
 *     <>
 *       <FormBanner searchParams={searchParams} />
 *       // ... rest of page
 *     </>
 *   );
 * }
 * ```
 */
export function FormBanner({ searchParams }) {
  const [isVisible, setIsVisible] = useState(true);

  const success = searchParams?.success;
  const error = searchParams?.error;
  const message = success || error;
  const type = success ? "success" : error ? "error" : null;

  useEffect(() => {
    if (message) {
      setIsVisible(true);
      // Auto-dismiss after 5 seconds
      const timer = setTimeout(() => {
        setIsVisible(false);
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  if (!message || !isVisible) return null;

  return (
    <div
      className={cn(
        "fixed top-4 right-4 z-50 max-w-md w-full px-4 py-3 rounded-lg shadow-lg border animate-in slide-in-from-top-2 duration-300",
        type === "success" && "bg-emerald-50 border-emerald-200 dark:bg-emerald-950 dark:border-emerald-800",
        type === "error" && "bg-red-50 border-red-200 dark:bg-red-950 dark:border-red-800"
      )}
      role="alert"
    >
      <div className="flex items-start gap-3">
        {type === "success" ? (
          <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
        ) : (
          <XCircle className="h-5 w-5 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
        )}
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              "text-sm font-medium",
              type === "success" && "text-emerald-900 dark:text-emerald-100",
              type === "error" && "text-red-900 dark:text-red-100"
            )}
          >
            {decodeURIComponent(message)}
          </p>
        </div>
        <button
          onClick={() => setIsVisible(false)}
          className={cn(
            "shrink-0 p-1 rounded hover:bg-black/5 dark:hover:bg-white/5 transition-colors",
            type === "success" && "text-emerald-600 dark:text-emerald-400",
            type === "error" && "text-red-600 dark:text-red-400"
          )}
          aria-label="Dismiss"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/**
 * Helper function to create success redirect URLs
 *
 * Usage in server actions:
 * ```js
 * import { createSuccessUrl, createErrorUrl } from "@/components/ui/form-banner";
 *
 * // Success
 * redirect(createSuccessUrl("/dashboard/stocks", "Product created successfully"));
 *
 * // Error
 * redirect(createErrorUrl("/dashboard/stocks/new", "Failed to create product"));
 * ```
 */
export function createSuccessUrl(path, message) {
  return `${path}?success=${encodeURIComponent(message)}`;
}

export function createErrorUrl(path, message) {
  return `${path}?error=${encodeURIComponent(message)}`;
}
