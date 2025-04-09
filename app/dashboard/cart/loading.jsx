"use client";

function loading() {
  const SkeletonRow = () => (
    <tr className="animate-pulse bg-white dark:bg-gray-900 border-b dark:border-gray-700">
      <td className="px-4 py-2">
        <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-20"></div>
      </td>
      <td className="px-4 py-2">
        <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-32"></div>
      </td>
      <td className="px-4 py-2">
        <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-24"></div>
      </td>
      <td className="px-4 py-2">
        <div className="flex items-center gap-2">
          <div className="h-8 w-8 bg-gray-300 dark:bg-gray-700 rounded"></div>
          <div className="h-4 w-6 bg-gray-300 dark:bg-gray-700 rounded"></div>
          <div className="h-8 w-8 bg-gray-300 dark:bg-gray-700 rounded"></div>
        </div>
      </td>
      <td className="px-4 py-2">
        <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-24"></div>
      </td>
      <td className="px-4 py-2 text-right">
        <div className="h-4 w-16 bg-gray-300 dark:bg-gray-700 rounded"></div>
      </td>
    </tr>
  );
  return (
    <>
      <div className="overflow-x-auto rounded-lg border dark:border-gray-700">
        <table className="w-full text-sm text-left text-gray-600 dark:text-gray-300">
          <thead className="text-xs uppercase bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300">
            <tr>
              <th className="px-4 py-3">SKU</th>
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Unit Price</th>
              <th className="px-4 py-3">Quantity</th>
              <th className="px-4 py-3">Total</th>
              <th className="px-4 py-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 8 }).map((_, idx) => (
              <SkeletonRow key={idx} />
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default loading;
