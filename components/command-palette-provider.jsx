"use client";

import { createContext, useContext, useState } from "react";
import { CommandPalette } from "./command-palette";

const CommandPaletteContext = createContext({ open: false, setOpen: () => {} });

export function useCommandPalette() {
  return useContext(CommandPaletteContext);
}

export function CommandPaletteProvider({ children }) {
  const [open, setOpen] = useState(false);

  return (
    <CommandPaletteContext.Provider value={{ open, setOpen }}>
      {children}
      <CommandPalette open={open} setOpen={setOpen} />
    </CommandPaletteContext.Provider>
  );
}
