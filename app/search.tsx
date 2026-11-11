// Search-only folding. Never write this value back to a contact or use it as identity.
const cyrillic: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh", з: "z",
  и: "i", й: "i", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r",
  с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts", ч: "ch", ш: "sh",
  щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};
const canonical = (value: unknown) => String(value ?? "").normalize("NFC").trim().toLocaleLowerCase("az");

export function normalizeSearch(value: unknown): string {
  return canonical(value).replace(/[əı]/g, (letter) => letter === "ə" ? "e" : "i")
    .replace(/[а-яё]/g, (letter) => cyrillic[letter] ?? letter)
    .normalize("NFD").replace(/\p{M}/gu, "").replace(/\s+/g, " ");
}

export function searchRank(value: unknown, query: unknown): number {
  const exact = canonical(value), needle = canonical(query);
  if (!needle || exact === needle) return 0;
  if (exact.startsWith(needle)) return 1;
  if (exact.includes(needle)) return 2;
  const folded = normalizeSearch(value), foldedNeedle = normalizeSearch(query);
  if (folded === foldedNeedle) return 3;
  if (folded.startsWith(foldedNeedle)) return 4;
  return folded.includes(foldedNeedle) ? 5 : 6;
}
