const clean = (value, limit = 80) => typeof value === "string"
  ? value.replace(/["\r\n\t]/g, " ").replace(/\s+/g, " ").trim().slice(0, limit).trim()
  : "";
const quoted = value => `"${value}"`;

export function defaultOsintQuery(contact) {
  const name = clean(contact.name, 120);
  const organization = clean(contact.organization);
  const role = clean(contact.role) || clean(contact.department);
  const location = Array.isArray(contact.locations) ? clean(contact.locations.find(value => typeof value === "string" && value.trim())) : "";
  return [name, organization, role, !organization ? location : !role ? location : ""].filter(Boolean).map(quoted).join(" ");
}

export function osintSearchPlan(contact, requestedQuery = "") {
  const name = clean(contact.name, 120);
  const organization = clean(contact.organization);
  const role = clean(contact.role) || clean(contact.department);
  const location = Array.isArray(contact.locations) ? clean(contact.locations.find(value => typeof value === "string" && value.trim())) : "";
  const primary = defaultOsintQuery(contact);
  const legacy = [name, organization].filter(Boolean).map(quoted).join(" ");
  const requested = String(requestedQuery || "").trim();
  if (requested && requested !== primary && requested !== legacy) return { query: requested, queries: [requested], automatic: false };

  const fallback = organization && (role || location)
    ? [name, organization].map(quoted).join(" ")
    : !organization && role && location
      ? [name, role].map(quoted).join(" ")
      : "";
  return { query: primary, queries: [...new Set([primary, fallback].filter(Boolean))], automatic: true };
}

export function suggestMaigretHandles(contact) {
  const suggestions = [];
  for (const social of Array.isArray(contact?.socials) ? contact.socials : []) {
    const value = String(social?.value || "").trim();
    let handle = value.replace(/^@/, "");
    try {
      const url = new URL(value);
      handle = url.pathname.split("/").filter(Boolean).at(-1) || "";
    } catch { /* A saved social handle need not be a URL. */ }
    if (/^[\p{L}\p{N}._-]{2,40}$/u.test(handle)) suggestions.push(handle);
  }
  const words = String(contact?.name || "").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().match(/[a-z0-9]+/g) || [];
  if (words.length >= 2) {
    const first = words[0];
    const last = words.at(-1);
    suggestions.push(first + last, first + "." + last, first + "_" + last);
  }
  return [...new Set(suggestions)].slice(0, 3);
}
