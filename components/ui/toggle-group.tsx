"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const toggleGroupVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline:
          "border border-input bg-transparent shadow-sm hover:bg-accent hover:text-accent-foreground",
      },
      size: {
        default: "h-9 px-3",
        sm: "h-8 px-2",
        lg: "h-10 px-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

interface ToggleGroupProps extends VariantProps<typeof toggleGroupVariants> {
  type: "single" | "multiple";
  value?: string | string[];
  onValueChange?: (value: string) => void;
  className?: string;
  children: React.ReactNode;
}

interface ToggleGroupContextValue extends VariantProps<typeof toggleGroupVariants> {
  type: "single" | "multiple";
  value?: string | string[];
  onValueChange?: (value: string) => void;
}

const ToggleGroupContext = React.createContext<ToggleGroupContextValue>({
  type: "single",
  size: "default",
  variant: "default",
});

const ToggleGroup = React.forwardRef<HTMLDivElement, ToggleGroupProps>(
  ({ className, variant, size, type, value, onValueChange, children, ...props }, ref) => (
    <div
      ref={ref}
      role="group"
      className={cn("flex items-center justify-center gap-1", className)}
      {...props}
    >
      <ToggleGroupContext.Provider value={{ variant, size, type, value, onValueChange }}>
        {children}
      </ToggleGroupContext.Provider>
    </div>
  )
);

ToggleGroup.displayName = "ToggleGroup";

interface ToggleGroupItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof toggleGroupVariants> {
  value: string;
}

const ToggleGroupItem = React.forwardRef<HTMLButtonElement, ToggleGroupItemProps>(
  ({ className, children, variant, size, value, ...props }, ref) => {
    const context = React.useContext(ToggleGroupContext);

    const isSelected = context.type === "single"
      ? context.value === value
      : Array.isArray(context.value) && context.value.includes(value);

    const handleClick = () => {
      context.onValueChange?.(value);
    };

    return (
      <button
        ref={ref}
        type="button"
        role="radio"
        aria-checked={isSelected}
        data-state={isSelected ? "on" : "off"}
        onClick={handleClick}
        className={cn(
          toggleGroupVariants({
            variant: context.variant || variant,
            size: context.size || size,
          }),
          isSelected && "bg-accent text-accent-foreground",
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);

ToggleGroupItem.displayName = "ToggleGroupItem";

export { ToggleGroup, ToggleGroupItem };
