export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const token = process.env.MERSAL_TOKEN;
  const api = (process.env.MERSAL_API_ENDPOINT || "").replace(/\/+$/g, "");

  if (!token) return res.status(500).json({ ok: false, error: "Missing MERSAL_TOKEN" });
  if (!api) return res.status(500).json({ ok: false, error: "Missing MERSAL_API_ENDPOINT" });

  const phoneRaw = String(req.body?.phone || "");
  const phone = phoneRaw.replace(/[^\d+]/g, "");
  if (!phone) return res.status(400).json({ ok: false, error: "Missing phone" });

  // رسالة افتتاحية (تقدر تغيرها براحتك)
  const text =
    String(req.body?.text || "").trim() ||
    "مرحباً 👋\nمعك فريق المبيعات.\nكيف نقدر نخدمك؟";

  // لو عندك template/lang في بيئة Vercel (مش لازم)
  const lang = (process.env.MERSAL_LANG || "ar").trim();
  const template = (process.env.MERSAL_TEMPLATE || "").trim();

  async function readResp(r) {
    const raw = await r.text();
    let json = null;
    try { json = JSON.parse(raw); } catch (_) {}
    return { raw, json };
  }

  // مرسال عندك يظهر في الدوكس wpbox / wpbx — فهنجرّب أكتر من مسار إرسال
  const bases = [
    `${api}/api/wpbox`,
    `${api}/api/wpbx`,
  ];

  // endpoints محتملة للإرسال (حسب اختلاف الإصدارات)
  const paths = [
    "sendMessage",
    "send-message",
    "sendText",
    "send-text",
    "messages/send",
  ];

  // body محتمل (نجرّب أكثر من شكل)
  const bodies = [
    // أبسط شكل: phone + message/text
    (b) => ({ phone, message: text, lang, template: template || undefined }),
    (b) => ({ phone, text, lang, template: template || undefined }),
    // أحياناً تكون to بدل phone
    (b) => ({ to: phone, message: text, lang, template: template || undefined }),
  ];

  for (const base of bases) {
    for (const p of paths) {
      const url = `${base}/${p}?token=${encodeURIComponent(token)}`;

      for (const mkBody of bodies) {
        const body = mkBody();

        try {
          const r = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });

          const out = await readResp(r);

          // نجاح: response ok + رجوع JSON يشير للنجاح
          const ok =
            r.ok &&
            (out.json?.ok === true ||
              out.json?.status === "success" ||
              out.json?.status === true ||
              out.json?.success === true);

          if (ok) {
            return res.status(200).json({
              ok: true,
              used: { base, path: p },
              response: out.json,
            });
          }

          // لو مش ok بس رجّع JSON فيه رسالة واضحة — نكمل نجرب لكن نخزن آخر خطأ
          // هنكمّل التجارب
        } catch (e) {
          // نكمل نجرب
        }
      }
    }
  }

  return res.status(500).json({
    ok: false,
    error: "Send failed (no matching endpoint/body)",
    hint: "Check MERSAL_API_ENDPOINT/token and confirm exact send endpoint in Mersal docs",
  });
}
