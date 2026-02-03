export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  try {
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ ok: false, error: "Phone required" });

    // normalize phone: digits only (9665xxxx)
    const cleanPhone = String(phone).replace(/[^\d]/g, "");

    const BASE = process.env.MERSAL_BASE_URL;          // https://w-mersal.com
    const TOKEN = process.env.MERSAL_TOKEN;            // token
    const TEMPLATE_NAME = process.env.MERSAL_TEMPLATE; // template name
    const TEMPLATE_LANG = process.env.MERSAL_LANG || "ar";

    // ✅ رجّع خطأ واضح بدل 500 مبهم
    if (!BASE) return res.status(500).json({ ok:false, error:"Missing env: MERSAL_BASE_URL" });
    if (!TOKEN) return res.status(500).json({ ok:false, error:"Missing env: MERSAL_TOKEN" });
    if (!TEMPLATE_NAME) return res.status(500).json({ ok:false, error:"Missing env: MERSAL_TEMPLATE" });

    const url = `${BASE.replace(/\/$/, "")}/api/wpbox/sendtemplatemessage`;

    const payload = {
      token: TOKEN,
      phone: cleanPhone,
      template_name: TEMPLATE_NAME,
      template_language: TEMPLATE_LANG,
      components: [] // ✅ قالب بدون متغيرات
    };

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await r.json().catch(() => ({}));

    // ✅ حتى لو مرسال رجّع خطأ: هنرجّعه لك واضح في response
    if (!r.ok) {
      return res.status(200).json({
        ok: false,
        error: "Mersal error",
        status: r.status,
        details: data,
      });
    }

    return res.status(200).json({ ok: true, data });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ ok: false, error: "Server error", details: String(e?.message || e) });
  }
}
