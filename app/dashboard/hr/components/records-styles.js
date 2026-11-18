/** Class names for the HR record screens — plain module, usable on the server and the client. */
export const inputClass = (error) =>
  `w-full rounded-md border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary ${error ? "border-destructive" : "border-border"}`;
