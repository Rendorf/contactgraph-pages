const entityMap = new Map([
  ["amp", "&"], ["lt", "<"], ["gt", ">"], ["quot", '"'], ["apos", "'"],
]);

function decodeEntities(value) {
  return String(value || "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_match, entity) => {
    if (entity[0] !== "#") return entityMap.get(entity.toLowerCase()) || "";
    const point = entity[1].toLowerCase() === "x" ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
    return Number.isInteger(point) && point > 0 && point <= 0x10ffff ? String.fromCodePoint(point) : "";
  });
}

function text(value) {
  return decodeEntities(String(value || "").replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function element(block, name) {
  const match = block.match(new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"));
  return match ? text(match[1]) : "";
}

function link(block) {
  const body = element(block, "link");
  if (body) return body;
  const match = block.match(/<link\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/i);
  return match ? decodeEntities(match[1]).trim() : "";
}

export function parsePublicFeed(raw) {
  if (typeof raw !== "string" || raw.length > 2_000_000) throw new Error("Feed is too large");
  if (/<!DOCTYPE|<!ENTITY/i.test(raw)) throw new Error("Feed declarations are not supported");
  const entries = [...raw.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].slice(0, 50);
  return entries.flatMap(([, , block]) => {
    const url = link(block);
    let parsed;
    try { parsed = new URL(url); } catch { return []; }
    if (!['https:', 'http:'].includes(parsed.protocol) || parsed.username || parsed.password) return [];
    return [{
      url: parsed.href,
      title: element(block, "title") || parsed.href,
      summary: element(block, "description") || element(block, "summary") || element(block, "content"),
      published: element(block, "pubDate") || element(block, "published") || element(block, "updated"),
    }];
  });
}
