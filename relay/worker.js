// Vinyl Scanner relay — runs on Cloudflare Workers, uses the Google Gemini API.
// It keeps your Gemini API key secret and lets only your GitHub Pages site use it.
// Needs one secret in the Worker settings: GEMINI_API_KEY

const ALLOWED_ORIGINS = ["https://rezoro05.github.io"];
// Tried in order: if the first model is out of free quota, the next one is used.
const MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest"];
const MAX_IMAGE_CHARS = 2500000; // base64 length, about 1.8 MB of photo
const MAX_PROMPT_CHARS = 2000;
const PER_MINUTE = 8; // scans per visitor per minute
const HEDGE_MS = 2500; // wait this long before also asking the backup model
const ATTEMPT_TIMEOUT_MS = 12000; // give up on a single model after this long

const hits = new Map();

function tooFast(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > PER_MINUTE;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      "Access-Control-Allow-Origin": allowed ? origin : ALLOWED_ORIGINS[0],
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      "Vary": "Origin",
    };
    const reply = (status, data) =>
      new Response(JSON.stringify(data), {
        status,
        headers: { ...cors, "Content-Type": "application/json" },
      });

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (!allowed) return reply(403, { error: "forbidden" });
    if (request.method !== "POST") return reply(405, { error: "method" });
    if (!env.GEMINI_API_KEY) return reply(500, { error: "no_key" });

    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    if (tooFast(ip)) return reply(429, { error: "rate_limited" });

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return reply(400, { error: "bad_json" });
    }
    const prompt = typeof body.prompt === "string" ? body.prompt.slice(0, MAX_PROMPT_CHARS) : "";
    const image = typeof body.image === "string" ? body.image : "";
    if (!prompt) return reply(400, { error: "no_prompt" });
    if (image.length > MAX_IMAGE_CHARS) return reply(413, { error: "image_too_large" });

    const parts = [];
    if (image) parts.push({ inlineData: { mimeType: "image/jpeg", data: image } });
    parts.push({ text: prompt });
    // "minimal" thinking makes the answer come back much faster. If a model
    // doesn't accept that setting (HTTP 400), the same model is retried without it.
    const makePayload = (fast) =>
      JSON.stringify({
        contents: [{ parts }],
        generationConfig: {
          responseMimeType: "application/json",
          maxOutputTokens: 1500,
          ...(fast ? { thinkingConfig: { thinkingLevel: "minimal" } } : {}),
        },
      });

    const started = Date.now();
    const attempt = async (model, fast) => {
      const res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/" + model + ":generateContent",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
          body: makePayload(fast),
          signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
        }
      );
      if (res.status === 400 && fast) return attempt(model, false);
      if (!res.ok) throw Object.assign(new Error("upstream"), { status: res.status });
      const data = await res.json();
      const cand = (data.candidates || [])[0] || {};
      const text = ((cand.content && cand.content.parts) || [])
        .filter((p) => typeof p.text === "string" && !p.thought)
        .map((p) => p.text)
        .join("");
      if (!text) throw Object.assign(new Error("empty"), { status: 502 });
      return { text, model, ms: Date.now() - started };
    };

    // Google's free tier sometimes leaves a request hanging. So: ask the first
    // model, and if it hasn't answered within HEDGE_MS (or it fails), also ask
    // the backup model. Whichever answers first wins.
    let settled = false;
    const first = attempt(MODELS[0], true);
    const backup = new Promise((resolve) => {
      const timer = setTimeout(resolve, HEDGE_MS);
      first.catch(() => {
        clearTimeout(timer);
        resolve();
      });
    }).then(() => {
      if (settled) throw new Error("not needed");
      return attempt(MODELS[1], true);
    });

    try {
      const won = await Promise.any([first, backup]);
      settled = true;
      return reply(200, won);
    } catch (err) {
      settled = true;
      const statuses = (err.errors || []).map((x) => x && x.status);
      if (statuses.includes(429)) return reply(429, { error: "rate_limited" });
      return reply(502, { error: "upstream", statuses });
    }
  },
};
