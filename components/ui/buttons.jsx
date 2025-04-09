"use client";
import { returnDNoteItems } from "../../app/mongodb/actions";
import { PencilIcon, PlusIcon } from "lucide-react";
import NextForm from "next/form";

import Link from "next/link";

export function CreateButton({ path, title }) {
  return (
    <Link
      href={path}
      className="flex h-10 items-center rounded-lg bg-primary px-4 text-sm font-medium
       text-white transition-colors hover:bg-primary focus-visible:outline 
       focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-yellow-600 my-2"
    >
      <span className="hidden md:block">{title}</span>{" "}
      <PlusIcon className="h-5 md:ml-4" />
    </Link>
  );
}

export function UpdateButton({ path }) {
  return (
    <Link href={path} className="rounded-md border p-2 hover:bg-gray-100 my-2">
      <PencilIcon className="w-5" />
    </Link>
  );
}
//style below accordingly add the necessary classes
export function ReturnDnoteItems({ id }) {
  const returnWithId = returnDNoteItems.bind(null, id);
  return (
    <NextForm action={returnWithId}>
      <button className="p-1 py-1 my-2 text-white bg-pink-500 dark:bg-pink-600 rounded hover:bg-pink-600 dark:hover:bg-pink-700">
        Return
      </button>
    </NextForm>
  );
}
