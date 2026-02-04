export default async function handler(req, res) {
  const token = process.env.MERSAL_TOKEN;
  const apiEndpoint = (process.env.MERSAL_API_ENDPOINT || "").replace(/\/+$/g, "");

  if (!token) return res.status(500).json({ ok: false, error: "Missing MERSAL_TOKEN" });
  if (!apiEndpoint) return res.status(500).json({ ok: false, error: "Missing MERSAL_API_ENDPOINT" });

  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const normalizeKSA = (v) => {
    let p = String(v || "").replace(/\D/g, "");
    if (p.length === 10 && p.startsWith("05")) p = "966" + p.slice(1);
    if (p.length === 9 && p.startsWith("5")) p = "966" + p;
    if (p.startsWith("00")) p = p.slice(2);
    return p;
  };

  const body = req.body || {};
  const message = String(body.message || "").trim();
  const phone = normalizeKSA(body.phone || "");

  if (!phone) return res.status(400).json({ ok: false, error: "Missing phone" });
  if (!message) return res.status(400).json({ ok: false, error: "Missing message" });

  try {
    const url = `${apiEndpoint}/api/wpbox/sendmessage`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, phone, message })
    });

    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}

    if (!r.ok || !data) {
      return res.status(500).json({ ok: false, step: "sendmessage", status: r.status, error: data || text });
    }

    return res.status(200).json({ ok: true, phone, data });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Unknown error" });
  }
}
