// Single source of truth for address formatting — zero dependencies so it
// is safe to import anywhere (client components, server actions, model
// methods, PDF renderers, migration scripts).
//
// Addresses live as objects on Party ({ line1, city, country, ... }) but as
// STRINGS on document snapshots (Quote/Invoice/Bill/PO customer/supplier).
// Some legacy snapshots stored the object stringified — e.g. the literal
// "{ country: 'Kenya' }". This collapses every shape to a clean one-line
// string ("line1, city, country") so the raw object never reaches a field
// or a screen.

export function formatAddress(address) {
  if (!address) return "";

  const fromObject = (a) =>
    [a.street || a.line1, a.line2, a.city, a.state, a.postalCode, a.country]
      .filter(Boolean)
      .join(", ");

  if (typeof address === "object") return fromObject(address);

  if (typeof address === "string") {
    const s = address.trim();
    // Serialized object? Try strict JSON, then a JS-object-literal
    // ("{ country: 'Kenya' }") by normalising keys/quotes.
    if (s.startsWith("{") && s.endsWith("}")) {
      try {
        return fromObject(JSON.parse(s));
      } catch {
        try {
          const normalised = s
            .replace(/([{,]\s*)(\w+):/g, '$1"$2":')
            .replace(/'/g, '"');
          return fromObject(JSON.parse(normalised));
        } catch {
          return s;
        }
      }
    }
    return s;
  }

  return "";
}
