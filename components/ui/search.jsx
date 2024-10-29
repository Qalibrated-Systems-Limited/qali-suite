"use client";

import { Input } from "../../components/ui/input";
import { SearchIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

import { useDebouncedCallback } from "use-debounce";

export default function Search({ placeholder }) {
  const searchParams = useSearchParams();

  const { replace } = useRouter();
  const pathname = usePathname();

  const handleSearch = useDebouncedCallback((term) => {
    const params = new URLSearchParams(searchParams);
    params.set("page", "1");
    if (term) {
      params.set("query", term);
    } else {
      params.delete("query");
    }

    replace(`${pathname}?${params.toString()}`);
  }, 300);
  return (
    <div className="relative flex flex-1 flex-shrink-0 min-w-[200px]  w-full md:min-w-[500px]">
      <label htmlFor="search" className="sr-only">
        Search
      </label>
      <Input
        className="peer block w-full rounded-md border  py-[9px] pl-10 text-sm outline-2 placeholder:text-gray-500"
        placeholder={placeholder}
        defaultValue={searchParams.get("query")?.toString()}
        onChange={(e) => handleSearch(e.target.value)}
      />
      <SearchIcon className="absolute left-3 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-gray-500 peer-focus:text-gray-900" />
    </div>
  );
}
