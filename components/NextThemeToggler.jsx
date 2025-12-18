"use client";
import React from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Button } from "./ui/button";
import { Sun } from "lucide-react";
import { Moon } from "lucide-react";
import { Monitor } from "lucide-react";
import { useEffect } from "react";
import { useTheme } from "next-themes";
import { useState } from "react";

export function NextThemeToggler() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    // Prevents hydration mismatch
    return (
      <button className="inline-flex h-9 w-9 items-center justify-center rounded-md">
        <Monitor className="w-5 h-5" />
      </button>
    );
  }
  return (
    <div className="px-4 py-2 border-t border-border">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-3 text-foreground/70 hover:bg-accent hover:text-foreground"
          >
            {theme === "light" ? (
              <Sun className="w-5 h-5" />
            ) : theme === "dark" ? (
              <Moon className="w-5 h-5" />
            ) : (
              <Monitor className="w-5 h-5" />
            )}
            <span className="text-sm font-medium">
              {theme === "light"
                ? "Light"
                : theme === "dark"
                ? "Dark"
                : "System"}
            </span>
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-48">
          <DropdownMenuItem onClick={() => setTheme("light")}>
            <Sun className="mr-2 h-4 w-4" />
            Light
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("dark")}>
            <Moon className="mr-2 h-4 w-4" />
            Dark
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => setTheme("system")}>
            <Monitor className="mr-2 h-4 w-4" />
            System
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
