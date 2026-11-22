const braveBaseUrl = "https://api.search.brave.com/res/v1";
let consumeBudget = async () => ({ used: 0, limit: Number(process.env.CONTACTGRAPH_BRAVE_MONTHLY_LIMIT || 2500) });

export function configureManagedSearchBudget(consumer) {
  if (typeof consumer !== "function") throw new TypeError("A managed-search budget consumer is required");
  consumeBudget = consumer;
}

function clean(value, limit = 2000) {
  return String(value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function https(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
  } catch { return ""; }
}

async function braveRequest(path, query, fetcher) {
  const key = process.env.BRAVE_SEARCH_API_KEY?.trim();
  if (!key) throw new Error("Managed web search is not configured");
  await consumeBudget();
  const url = new URL(braveBaseUrl + path);
  url.searchParams.set("q", query);
  url.searchParams.set("count", "20");
  url.searchParams.set("safesearch", "strict");
  let response;
  try {
    response = await fetcher(url, { headers: { accept: "application/json", "x-subscription-token": key, "user-agent": "ContactGraph-OSINT/2.0" }, signal: AbortSignal.timeout(20_000) });
  } catch { throw new Error("Managed web search is temporarily unavailable"); }
  if (response.status === 429) throw new Error("Managed web search is rate limited");
  if (!response.ok) throw new Error(`Managed web search returned ${response.status}`);
  return response.json().catch(() => { throw new Error("Managed web search returned invalid data"); });
}

function searxRequest(baseUrl, query, category, fetcher) {
  const url = new URL("/search", baseUrl);
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("categories", category);
  return fetcher(url, { signal: AbortSignal.timeout(20_000) }).then(async response => {
    if (!response.ok) throw new Error(`Web search returned ${response.status}`);
    const body = await response.json();
    return Array.isArray(body.results) ? body.results : [];
  });
}

export async function searchWeb(query, category = "general", { fetcher = fetch, searxUrl = process.env.CONTACTGRAPH_SEARXNG_URL } = {}) {
  if (typeof query !== "string" || !query.trim() || query.length > 400) throw new Error("Invalid web search query");
  if (!["general", "general,news", "news", "images"].includes(category)) throw new Error("Invalid web search category");
  if (!process.env.BRAVE_SEARCH_API_KEY && searxUrl) return searxRequest(searxUrl, query, category, fetcher);
  const path = category === "images" ? "/images/search" : category === "news" ? "/news/search" : "/web/search";
  const body = await braveRequest(path, query.trim(), fetcher);
  const raw = category === "general" ? body.web?.results : body.results;
  return (Array.isArray(raw) ? raw : []).flatMap(result => {
    const source = https(result.url || result.source?.url || result.properties?.url);
    if (!source) return [];
    if (category === "images") {
      const image = https(result.properties?.url || result.image_url || result.img_src);
      const thumbnail = https(result.thumbnail?.src || result.thumbnail_url || result.thumbnail_src);
      if (!image && !thumbnail) return [];
      return [{ url: source, img_src: image || thumbnail, thumbnail_src: thumbnail, title: clean(result.title || source, 500), content: clean(result.description || result.source?.name) }];
    }
    return [{ url: source, title: clean(result.title || source, 500), content: clean(result.description || result.snippet), publishedDate: clean(result.age || result.page_age || result.published_time, 100), engine: "Brave Search" }];
  });
}
