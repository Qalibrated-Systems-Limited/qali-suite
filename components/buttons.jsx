import { PencilIcon, PlusIcon, Plus, Download, FileText } from "lucide-react";
import Link from "next/link";
import { Button } from "./ui/button";
import { IconEdit } from "@tabler/icons-react";

export function CreateButton({ path, title }) {
  return (
    <Link
      href={path}
      className="flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium
       text-white transition-colors hover:bg-primary  
       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-600"
    >
      <span className="hidden md:block">{title}</span>{" "}
      <PlusIcon className="h-5 md:ml-4" />
    </Link>
  );
}

export const AddButton = ({ title, url }) => (
  <Button variant="primary" size="sm" asChild>
    <Link href={url}>{title || "CREATE"}</Link>
  </Button>
);

export function UpdateButton({ path }) {
  return (
    <Button asChild variant="ghost" size="icon" className="h-8 w-8">
      <Link href={path}>
        <IconEdit className="h-4 w-4" />
        <span className="sr-only">Edit</span>
      </Link>
    </Button>
  );
}

export function ViewButton({ path }) {
  return (
    <Button asChild variant="ghost" size="icon" className="h-8 w-8">
      <Link href={path}>
        <IconEye className="h-4 w-4" />
        <span className="sr-only">View details</span>
      </Link>
    </Button>
  );
}

// Primary Add Button (Yellow - GitHub style)
// export function AddButton({ title = "New", url = "#" }) {
//   return (
//     <Button
//       asChild
//       className="bg-yellow-500 text-black hover:bg-yellow-600 font-medium"
//     >
//       <Link href={url}>
//         <Plus className="w-4 h-4 mr-2" />
//         {title}
//       </Link>
//     </Button>
//   );
// }

// Secondary Action Button
export function ActionButton({ title, url, icon: Icon, variant = "outline" }) {
  return (
    <Button
      asChild
      variant={variant}
      className="border-[#30363d] text-gray-300 hover:bg-[#1f2937] hover:text-white"
    >
      <Link href={url}>
        {Icon && <Icon className="w-4 h-4 mr-2" />}
        {title}
      </Link>
    </Button>
  );
}

// Download Button (for exports)
export function DownloadButton({ title = "Download", onClick }) {
  return (
    <Button
      variant="outline"
      onClick={onClick}
      className="border-[#30363d] text-gray-300 hover:bg-[#1f2937] hover:text-white"
    >
      <Download className="w-4 h-4 mr-2" />
      {title}
    </Button>
  );
}

// Export Button (for PDF, Excel, etc)
export function ExportButton({ title = "Export", onClick }) {
  return (
    <Button
      variant="outline"
      onClick={onClick}
      className="border-[#30363d] text-gray-300 hover:bg-[#1f2937] hover:text-white"
    >
      <FileText className="w-4 h-4 mr-2" />
      {title}
    </Button>
  );
}

// Multiple Actions Group
export function ActionGroup({ children }) {
  return <div className="flex items-center gap-2">{children}</div>;
}
