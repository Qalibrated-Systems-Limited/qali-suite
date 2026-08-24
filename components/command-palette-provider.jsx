"use client";

import { createContext, useContext, useState } from "react";
import { CommandPalette } from "./command-palette";

const CommandPaletteContext = createContext({ open: false, setOpen: () => {} });

export function useCommandPalette() {
  return useContext(CommandPaletteContext);
}

/**
 * `companyPlan` and `role` come from the session in app/dashboard/layout.js —
 * the palette is a client component and cannot read it — so that it can leave
 * out the modules this plan does not include.
 */
export function CommandPaletteProvider({ children, companyPlan, role }) {
  const [open, setOpen] = useState(false);

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen }}>
      {children}
      <CommandPalette
        open={open}
        setOpen={setOpen}
        companyPlan={companyPlan}
        role={role}
      />
    </CommandPaletteContext.Provider>
  );
}
