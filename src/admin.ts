import { config } from "./config";

export function assertImportAuth(req: Request): Response | null {
  const secret = config.historyImportSecret?.trim();
  if (!secret) {
    return new Response(JSON.stringify({ error: "import disabled (no HISTORY_IMPORT_SECRET)" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token || token !== secret) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  return null;
}
