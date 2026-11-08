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

export async function hermesRequest(name: keyof typeof paths, options: RequestInit = {}) {
  const user = auth?.currentUser;
  if (!user) throw new Error("Sign in before using message generation.");
  if (!navigator.onLine) throw new Error("Connect to the internet before using message generation.");
  let response: Response;
  try {
    const headers = new Headers(options.headers);
    headers.set("authorization", `Bearer ${await user.getIdToken()}`);
    if (options.body) headers.set("content-type", "application/json");
    response = await fetch(`${origin}${paths[name]}`, {
      ...options,
      headers,
      cache: "no-store",
      signal: AbortSignal.timeout(name === "holiday" || name === "birthday" ? 75_000 : 12_000),
    });
  } catch { throw new Error("Hermes is unavailable. Message generation will work when its service returns."); }
  const body = await response.json().catch(() => ({})) as { error?: unknown };
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : "Hermes could not complete the request.");
  return body;
}
