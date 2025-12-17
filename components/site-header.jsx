import { Button } from "@/components/ui/button";

export function SiteHeader({ title = "Dashboard", Action }) {
  return (
    <header className="border-b border-[#30363d] bg-[#0d1117]">
      <div className="flex items-center justify-between px-4 md:px-6 lg:px-8 py-4">
        {/* Title Section */}
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">{title}</h1>
        </div>

        {/* Actions Section */}
        {Action && (
          <div className="flex items-center gap-2">
            <Action />
          </div>
        )}
      </div>
    </header>
  );
}

// Alternative version with description support
export function SiteHeaderWithDescription({
  title = "Dashboard",
  description,
  Action,
}) {
  return (
    <header className="border-b border-[#30363d] bg-[#0d1117]">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 px-4 md:px-6 lg:px-8 py-4">
        {/* Title & Description Section */}
        <div>
          <h1 className="text-xl md:text-2xl font-bold text-white">{title}</h1>
          {description && (
            <p className="text-sm text-gray-400 mt-1">{description}</p>
          )}
        </div>

        {/* Actions Section */}
        {Action && (
          <div className="flex items-center gap-2">
            <Action />
          </div>
        )}
      </div>
    </header>
  );
}

// Minimal version - just title
export function SiteHeaderMinimal({ title = "Dashboard" }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-bold text-white">{title}</h1>
    </div>
  );
}
