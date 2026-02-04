export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const token = process.env.MERSAL_TOKEN;
  const api = (process.env.MERSAL_API_ENDPOINT || "").replace(/\/+$/g, "");
  if (!token) return res.status(500).json({ ok: false, error: "Missing MERSAL_TOKEN" });
  if (!api) return res.status(500).json({ ok: false, error: "Missing MERSAL_API_ENDPOINT" });

  const phoneRaw = String(req.body?.phone || "");
  const phone = phoneRaw.replace(/[^\d+]/g, "");
  if (!phone) return res.status(400).json({ ok: false, error: "Missing phone" });
  const cleanPhone = phone.replace(/\D/g, "");

  const read = async (r) => {
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { text, json };
  };

  // جرّب wpbox ثم wpbx (حسب اللي ظهر عندك في اللوج)
  const bases = [
    `${api}/api/wpbox`,
    `${api}/api/wpbx`,
  ];

  for (const base of bases) {
    // 1) getContacts
    const url = `${base}/getContacts?token=${encodeURIComponent(token)}`;
    const r1 = await fetch(url);
    const p1 = await read(r1);

    if (!r1.ok || !p1.json) {
      // جرّب اللي بعده
      continue;
    }

    const contacts = p1.json.contacts || p1.json.data?.contacts || [];
    let contact = contacts.find(c => {
      const p = String(c.phone || c.mobile || c.number || "").replace(/\D/g, "");
      return p === cleanPhone;
    });

    // 2) makeContact لو مش موجود
    if (!contact) {
      const url2 = `${base}/makeContact?token=${encodeURIComponent(token)}`;
      const r2 = await fetch(url2, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name: phone })
      });
      const p2 = await read(r2);

      if (!r2.ok || !p2.json) {
        return res.status(500).json({
          ok: false,
          step: "makeContact",
          usedBase: base,
          status: r2.status,
          error: p2.json?.message || p2.text?.slice(0, 180) || "makeContact failed"
        });
      }

      contact = p2.json.contact || p2.json.data?.contact || null;
    }

    const contactId = contact?.id || contact?.contact_id;
    if (!contactId) {
      return res.status(500).json({
        ok: false,
        step: "resolveContactId",
        usedBase: base,
        error: "No contact id",
        debug: contact
      });
    }

    // ✅ فتح المحادثة داخل مرسال
    const chatUrl = `https://w-mersal.com/chat?contact_id=${encodeURIComponent(contactId)}`;
    return res.status(200).json({ ok: true, url: chatUrl, contactId, usedBase: base });
  }

  // لو فشل في الاتنين، رجّع تفاصيل واضحة
  return res.status(500).json({
    ok: false,
    step: "getContacts",
    error: "Bad endpoint",
    tried: bases
  });
}
