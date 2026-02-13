"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";

export default function GlobalError({ error, reset }) {
  useEffect(() => {
    console.error("Global Error:", error);
  }, [error]);

  return (
    <html>
      <body>
        <div className="min-h-screen bg-[#0d1117] flex items-center justify-center p-4">
          <div className="max-w-2xl w-full bg-[#161b22] border border-[#30363d] rounded-lg p-8">
            {/* Error Icon */}
            <div className="flex justify-center mb-6">
              <div className="w-20 h-20 bg-red-500/10 rounded-full flex items-center justify-center">
                <AlertTriangle className="w-10 h-10 text-red-400" />
              </div>
            </div>

            {/* Error Alert */}
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4 mb-6">
              <div className="flex items-start gap-3">
                <AlertTriangle className="h-5 w-5 text-red-400 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-red-400 font-semibold text-lg mb-2">
                    Critical Error
                  </h3>
                  <p className="text-red-400 text-sm">
                    A critical error occurred that prevented the application
                    from loading properly.
                  </p>
                </div>
              </div>
            </div>

            {/* Error Details (Development) */}
            {process.env.NODE_ENV === "development" && error && (
              <div className="mb-6 p-4 bg-[#21262d] rounded-lg border border-[#30363d]">
                <p className="text-xs font-mono text-gray-400 mb-2">
                  Error Details (Development Only):
                </p>
                <p className="text-sm text-red-400 font-mono break-all">
                  {error.message}
                </p>
              </div>
            )}

            {/* Main Message */}
            <div className="text-center space-y-4 mb-8">
              <h2 className="text-2xl font-bold text-white">
                Application Error
              </h2>
              <p className="text-gray-400">
                The application encountered a critical error. Please try
                reloading the page.
              </p>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <button
                onClick={reset}
                className="inline-flex items-center justify-center px-6 py-3 bg-[#eab308] hover:bg-[#ca8a04] text-black font-medium rounded-lg transition-colors"
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Reload Page
              </button>
              <a
                href="/"
                className="inline-flex items-center justify-center px-6 py-3 bg-transparent border border-[#30363d] text-white hover:bg-[#21262d] rounded-lg transition-colors"
              >
                <Home className="mr-2 h-4 w-4" />
                Go Home
              </a>
            </div>

            {/* Help Text */}
            <div className="mt-8 p-4 bg-[#21262d]/50 rounded-lg border border-[#30363d]">
              <p className="text-xs text-gray-400 text-center">
                If this error persists, please contact your system administrator
                for assistance.
              </p>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
