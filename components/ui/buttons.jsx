import { PencilIcon, PlusIcon } from "lucide-react";
import Link from "next/link";

export function CreateButton({ path, title }) {
  return (
    <Link
      href={path}
      className="flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium
       text-white transition-colors hover:bg-primary focus-visible:outline 
       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-600"
    >
      <span className="hidden md:block">{title}</span>{" "}
      <PlusIcon className="h-5 md:ml-4" />
    </Link>
  );
}

export function UpdateButton({ path }) {
  return (
    <Link href={path} className="rounded-md border p-2 hover:bg-gray-100">
      <PencilIcon className="w-5" />
    </Link>
  );
}

export function SellI({ path }) {
  return (
    <Link href={path} className="rounded-md border p-2 hover:bg-gray-100">
      <PencilIcon className="w-5" />
    </Link>
  );
}
