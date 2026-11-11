import { auth } from "./firebase";

const origin = "https://api.contacts.vusalkhalilov.com";
const paths = {
  availability: "/v1/firebase/availability",
  settings: "/v1/firebase/settings",
  key: "/v1/firebase/openai-key",
  model: "/v1/firebase/openai-model",
  birthday: "/v1/firebase/birthday",
  holiday: "/v1/firebase/holiday",
} as const;

async function authorizedFetch(path: string, options: RequestInit, timeout: number) {
  const user = auth?.currentUser;
  if (!user) throw new Error("Sign in before using Hermes features.");
  if (!navigator.onLine) throw new Error("Connect to the internet before using Hermes features.");
  try {
    const headers = new Headers(options.headers);
    headers.set("authorization", `Bearer ${await user.getIdToken()}`);
    if (options.body) headers.set("content-type", "application/json");
    return await fetch(`${origin}${path}`, {
      ...options,
      headers,
      cache: "no-store",
      signal: options.signal ?? AbortSignal.timeout(timeout),
    });
  } catch { throw new Error("Hermes is unavailable. This feature will work when its service returns."); }
}

export async function hermesRequest(name: keyof typeof paths, options: RequestInit = {}) {
  const response = await authorizedFetch(paths[name], options, name === "holiday" || name === "birthday" ? 75_000 : 12_000);
  const body = await response.json().catch(() => ({})) as { error?: unknown };
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Hermes could not complete the request.");
  return body;
}

export function hermesOsintFetch(path: string, options: RequestInit = {}) {
  if (!/^\/api\/osint(?:\/|$)/.test(path) || path.includes("?") || path.includes("#")) throw new Error("Invalid OSINT path.");
  return authorizedFetch(path.replace(/^\/api\/osint/, "/v1/firebase/osint"), options, /\/(?:search|run)$/.test(path) ? 90_000 : 30_000);
}
