"use client";

import { useTransition, useState, useEffect } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { Search, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function CategorySearch({ defaultValue = "" }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState(defaultValue);

  // Sync with URL on mount
  useEffect(() => {
    setValue(searchParams.get("search") || "");
  }, [searchParams]);

  const handleSearch = (newValue) => {
    setValue(newValue);

    // Debounce the search
    const timeoutId = setTimeout(() => {
      const params = new URLSearchParams(searchParams);

      if (newValue.trim()) {
        params.set("search", newValue.trim());
      } else {
        params.delete("search");
      }

      startTransition(() => {
        router.replace(`${pathname}?${params.toString()}`);
      });
    }, 300);

    return () => clearTimeout(timeoutId);
  };

  const handleClear = () => {
    setValue("");
    const params = new URLSearchParams(searchParams);
    params.delete("search");

    startTransition(() => {
      router.replace(`${pathname}?${params.toString()}`);
    });
  };

  return (
    <div className="relative">
      {isPending ? (
        <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground animate-spin" />
      ) : (
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      )}
      <Input
        type="text"
        placeholder="Search categories..."
        value={value}
        onChange={(e) => handleSearch(e.target.value)}
        className="pl-10 pr-10"
      />
      {value && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
          onClick={handleClear}
          disabled={isPending}
        >
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}
