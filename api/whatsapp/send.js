export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const token = process.env.MERSAL_TOKEN;
  const api = (process.env.MERSAL_API_ENDPOINT || "").replace(/\/+$/g, "");

  if (!token) return res.status(500).json({ ok: false, error: "Missing MERSAL_TOKEN" });
  if (!api) return res.status(500).json({ ok: false, error: "Missing MERSAL_API_ENDPOINT" });

  const phone = String(req.body?.phone || "").replace(/\D/g, "");
  const message = String(req.body?.message || "").trim() || "مرحباً 👋\nكيف نقدر نخدمك؟";

  if (!phone) return res.status(400).json({ ok: false, error: "Missing phone" });

  try {
    // حسب الدوكس: POST {api_endpoint}/api/wpbox/sendmessage
    const r = await fetch(`${api}/api/wpbox/sendmessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, phone, message }),
    });

    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }

    if (!r.ok) {
      return res.status(500).json({ ok: false, step: "SendMessage", status: r.status, error: data });
    }

    // الدوكس: status 200 نجاح
    return res.status(200).json({ ok: true, response: data });
  } catch (e) {
    return res.status(500).json({ ok: false, step: "exception", error: e?.message || "Unknown error" });
  }
}
