export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const token = process.env.MERSAL_TOKEN;
  const apiEndpoint = (process.env.MERSAL_API_ENDPOINT || "").replace(/\/+$/g, "");

  if (!token) return res.status(500).json({ ok: false, error: "Missing MERSAL_TOKEN" });
  if (!apiEndpoint) return res.status(500).json({ ok: false, error: "Missing MERSAL_API_ENDPOINT" });

  try {
    const r = await fetch(`${apiEndpoint}/api/wpbox/getConversations/none?mobile_api=true`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token })
    });

    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}

    if (!r.ok) {
      return res.status(500).json({ ok: false, step: "getConversations", status: r.status, error: data || text });
    }

    return res.status(200).json({ ok: true, conversations: data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Unknown error" });
  }
}
