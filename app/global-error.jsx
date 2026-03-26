"use client";

export default function GlobalError({ error, reset }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#0a0a0a",
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          color: "#fafafa",
          padding: "1rem",
        }}
      >
        <div
          style={{
            maxWidth: "32rem",
            width: "100%",
            border: "1px solid #27272a",
            borderRadius: "0.75rem",
            padding: "2rem",
            backgroundColor: "#18181b",
          }}
        >
          {/* Error Icon */}
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginBottom: "1.5rem",
            }}
          >
            <div
              style={{
                width: "5rem",
                height: "5rem",
                backgroundColor: "rgba(239, 68, 68, 0.1)",
                borderRadius: "50%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "2.5rem",
              }}
            >
              !
            </div>
          </div>

          {/* Heading */}
          <h1
            style={{
              textAlign: "center",
              fontSize: "1.5rem",
              fontWeight: 700,
              margin: "0 0 0.5rem",
            }}
          >
            Something went wrong
          </h1>

          {/* Description */}
          <p
            style={{
              textAlign: "center",
              color: "#a1a1aa",
              margin: "0 0 1.5rem",
              lineHeight: 1.6,
            }}
          >
            We encountered an unexpected error. Don&apos;t worry, our team has
            been notified and we&apos;re working on it.
          </p>

          {/* Reference code */}
          {error?.digest && (
            <p
              style={{
                textAlign: "center",
                fontSize: "0.75rem",
                color: "#71717a",
                fontFamily: "monospace",
                marginBottom: "1.5rem",
              }}
            >
              Reference: {error.digest}
            </p>
          )}

          {/* Buttons */}
          <div
            style={{
              display: "flex",
              gap: "0.75rem",
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <button
              onClick={() => reset()}
              style={{
                padding: "0.625rem 1.25rem",
                backgroundColor: "#eab308",
                color: "#000",
                border: "none",
                borderRadius: "0.375rem",
                fontWeight: 600,
                cursor: "pointer",
                fontSize: "0.875rem",
              }}
            >
              Try Again
            </button>
            <a
              href="/"
              style={{
                padding: "0.625rem 1.25rem",
                backgroundColor: "transparent",
                color: "#fafafa",
                border: "1px solid #27272a",
                borderRadius: "0.375rem",
                fontWeight: 600,
                cursor: "pointer",
                fontSize: "0.875rem",
                textDecoration: "none",
                display: "inline-block",
              }}
            >
              Go to Home
            </a>
          </div>

          {/* Help text */}
          <div
            style={{
              marginTop: "2rem",
              padding: "1rem",
              backgroundColor: "rgba(39, 39, 42, 0.5)",
              borderRadius: "0.5rem",
              border: "1px solid #27272a",
            }}
          >
            <p
              style={{
                fontSize: "0.75rem",
                color: "#71717a",
                textAlign: "center",
                margin: 0,
              }}
            >
              If this problem persists, please contact your system administrator
              or use the feedback button to report the issue.
            </p>
          </div>
        </div>
      </body>
    </html>
  );
}
