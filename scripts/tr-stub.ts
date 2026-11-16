import en from "../defaults/locales/en.json";

/** The mods' `tr()` in tests: English text, `{name}` filled from vars. */
export const tr = (key: string, vars: Record<string, unknown> = {}): string =>
  ((en as Record<string, string>)[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => String(vars[n] ?? ""));
