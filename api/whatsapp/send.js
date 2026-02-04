export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const token = process.env.MERSAL_TOKEN;
  const apiEndpoint = (process.env.MERSAL_API_ENDPOINT || "").replace(/\/+$/g, "");

  if (!token) return res.status(500).json({ ok: false, error: "Missing MERSAL_TOKEN" });
  if (!apiEndpoint) return res.status(500).json({ ok: false, error: "Missing MERSAL_API_ENDPOINT" });

  const phoneRaw = String(req.body?.phone || "");
  const phone = phoneRaw.replace(/[^\d+]/g, "");
  if (!phone) return res.status(400).json({ ok: false, error: "Missing phone" });

  // Optional: user-provided message text, otherwise default welcome text
  const text =
    String(req.body?.text || "").trim() ||
    "مرحباً 👋\nمعك فريق المبيعات.\nكيف نقدر نخدمك؟";

  // Helpers
  async function readResp(r) {
    const raw = await r.text();
    let json = null;
    try { json = JSON.parse(raw); } catch (_) {}
    return { raw, json };
  }

  // Mersal endpoints vary; try common bases & routes.
  const bases = [
    `${apiEndpoint}/api/wpbox`,
    `${apiEndpoint}/api/wpbx`,
  ];

  const routes = [
    "sendMessage",
    "send-message",
    "sendText",
    "send-text",
    "messages/send",
    "send",
  ];

  // Common payload shapes
  const payloads = [
    () => ({ phone, message: text }),
    () => ({ phone, text }),
    () => ({ to: phone, message: text }),
    () => ({ to: phone, text }),
  ];

  let lastError = null;

  for (const base of bases) {
    for (const route of routes) {
      const url = `${base}/${route}?token=${encodeURIComponent(token)}`;

      for (const mk of payloads) {
        const body = mk();

        try {
          const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          const out = await readResp(r);

          // Success heuristics
          const ok =
            r.ok &&
            (out.json?.ok === true ||
              out.json?.success === true ||
              out.json?.status === true ||
              out.json?.status === "success" ||
              (typeof out.json?.message === "string" && out.json.message.toLowerCase().includes("success")));

          if (ok) {
            return res.status(200).json({
              ok: true,
              used: { base, route },
              response: out.json,
            });
          }

          lastError = {
            base,
            route,
            status: r.status,
            error: out.json?.message || out.json?.error || out.raw?.slice(0, 250) || "Unknown error",
          };
        } catch (e) {
          lastError = { base, route, status: 0, error: e?.message || "Network error" };
        }
      }
    }
  }

  return res.status(500).json({
    ok: false,
    error: "Send failed (no matching endpoint/body)",
    lastError,
    hint: "Verify the exact send endpoint in your Mersal API docs and ensure MERSAL_API_ENDPOINT points to the API host (e.g., https://api.w-mersal.com).",
  });
}
