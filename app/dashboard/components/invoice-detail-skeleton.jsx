import React from "react";

export const InvoiceDetailsSkeleton = () => {
  return (
    <div className="bg-background text-foreground p-6 min-h-screen">
      <div className="max-w-4xl mx-auto bg-white dark:bg-gray-800 shadow-lg rounded-lg p-6 animate-pulse">
        <header className="mb-6 flex justify-between items-center">
          <div>
            <div className="h-8 bg-gray-300 rounded w-1/2 mb-2"></div>
            <div className="h-4 bg-gray-300 rounded w-1/4 mb-1"></div>
            <div className="h-4 bg-gray-300 rounded w-1/4 mb-1"></div>
          </div>
          <div className="h-10 bg-gray-300 rounded w-20"></div>
        </header>
        <section className="mb-6">
          <div className="h-6 bg-gray-300 rounded w-1/3 mb-2"></div>
          <div className="space-y-2">
            <div className="h-4 bg-gray-300 rounded w-1/2"></div>
            <div className="h-4 bg-gray-300 rounded w-1/3"></div>
            <div className="h-4 bg-gray-300 rounded w-1/4"></div>
          </div>
        </section>
        <section className="mb-6">
          <div className="h-6 bg-gray-300 rounded w-1/3 mb-2"></div>
          <div className="h-4 bg-gray-300 rounded w-3/4"></div>
        </section>
        <section className="mb-6">
          <div className="h-6 bg-gray-300 rounded w-1/3 mb-2"></div>
          <table className="min-w-full bg-white dark:bg-gray-800">
            <thead>
              <tr className="w-full bg-gray-200 dark:bg-gray-700">
                <th className="px-4 py-2 text-left">
                  <div className="h-4 bg-gray-300 rounded w-full"></div>
                </th>
                <th className="px-4 py-2 text-left">
                  <div className="h-4 bg-gray-300 rounded w-full"></div>
                </th>
                <th className="px-4 py-2 text-left">
                  <div className="h-4 bg-gray-300 rounded w-full"></div>
                </th>
                <th className="px-4 py-2 text-left">
                  <div className="h-4 bg-gray-300 rounded w-full"></div>
                </th>
                <th className="px-4 py-2 text-left">
                  <div className="h-4 bg-gray-300 rounded w-full"></div>
                </th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: 3 }).map((_, index) => (
                <tr key={index} className="border-t">
                  <td className="px-4 py-2">
                    <div className="h-4 bg-gray-300 rounded w-full"></div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="h-4 bg-gray-300 rounded w-full"></div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="h-4 bg-gray-300 rounded w-full"></div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="h-4 bg-gray-300 rounded w-full"></div>
                  </td>
                  <td className="px-4 py-2">
                    <div className="h-4 bg-gray-300 rounded w-full"></div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="h-10 bg-gray-300 rounded w-1/4 mt-4"></div>
        </section>
        <section className="mb-6">
          <div className="h-6 bg-gray-300 rounded w-1/3 mb-2"></div>
          <div className="space-y-2">
            <div className="h-4 bg-gray-300 rounded w-1/2"></div>
            <div className="h-4 bg-gray-300 rounded w-1/3"></div>
            <div className="h-4 bg-gray-300 rounded w-1/4"></div>
            <div className="h-4 bg-gray-300 rounded w-1/4"></div>
          </div>
        </section>
      </div>
    </div>
  );
};
