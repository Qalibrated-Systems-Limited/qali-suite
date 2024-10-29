"use client"; // Error components must be Client Components

import { useEffect } from "react";

export default function Error({ error, reset }) {
  useEffect(() => {
    // Log the error to an error reporting service
    console.error(error);
  }, [error]);

  return (
    <div className="w-full items-center justify-center text-center h-screen mt-10">
      <h4 className="text-red-400">Something went wrong!</h4>
      <button
        onClick={
          // Attempt to recover by trying to re-render the segment
          () => reset()
        }
      >
        <p className="text-red-200">Try again</p>
      </button>
    </div>
  );
}
