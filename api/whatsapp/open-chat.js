export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const token = process.env.MERSAL_TOKEN;
  if (!token) return res.status(500).json({ ok: false, error: "Missing MERSAL_TOKEN" });

  const apiEndpoint = (process.env.MERSAL_API_ENDPOINT || "https://w-mersal.com").replace(/\/+$/g, "");
  const phoneRaw = String(req.body?.phone || "");
  const phone = phoneRaw.replace(/[^\d+]/g, "");
  if (!phone) return res.status(400).json({ ok: false, error: "Missing phone" });

  const cleanPhone = phone.replace(/\D/g, "");

  async function readResp(r) {
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { text, json };
  }

  // مسارات محتملة (جرّبنا كل المشهورين)
  const baseCandidates = [
    `${apiEndpoint}/api/wpbx`,
    `${apiEndpoint}/api/wpbox`,
    `${apiEndpoint}/wpbx`,
    `${apiEndpoint}/wpbox`,
    `${apiEndpoint}/public/api/wpbx`,
    `${apiEndpoint}/public/api/wpbox`,
  ];

  async function tryGetContacts(base) {
    const url = `${base}/getContacts?token=${encodeURIComponent(token)}`;
    const r = await fetch(url);
    const p = await readResp(r);
    return { ok: r.ok, status: r.status, url, ...p };
  }

  async function tryMakeContact(base) {
    const url = `${base}/makeContact?token=${encodeURIComponent(token)}`;
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phone, name: phone })
    });
    const p = await readResp(r);
    return { ok: r.ok, status: r.status, url, ...p };
  }

  let lastErr = null;

  for (const base of baseCandidates) {
    // 1) getContacts
    const gc = await tryGetContacts(base);

    // لو رجع HTML 404 سيبنا يكمل يجرب المسار اللي بعده
    if (!gc.ok) {
      lastErr = { step: "getContacts", base, status: gc.status, sample: (gc.text || "").slice(0, 120) };
      continue;
    }

    const contacts = gc.json?.contacts || gc.json?.data?.contacts || [];
    let contact = contacts.find(c => {
      const p = String(c.phone || c.mobile || c.number || "").replace(/\D/g, "");
      return p === cleanPhone;
    });

    // 2) لو مش موجود → makeContact
    if (!contact) {
      const mc = await tryMakeContact(base);
      if (!mc.ok) {
        lastErr = { step: "makeContact", base, status: mc.status, sample: (mc.text || "").slice(0, 160) };
        continue;
      }
      contact = mc.json?.contact || mc.json?.data?.contact || null;
    }

    const contactId = contact?.id || contact?.contact_id;
    if (!contactId) {
      lastErr = { step: "resolveContactId", base, status: 500, sample: JSON.stringify(contact || {}).slice(0, 180) };
      continue;
    }

    // ✅ رابط فتح مرسال (حسب اللي عندك فعليًا)
    const chatUrl = `https://w-mersal.com/chat?contact_id=${encodeURIComponent(contactId)}`;
    return res.status(200).json({ ok: true, url: chatUrl, contactId, usedBase: base });
  }

  return res.status(500).json({
    ok: false,
    step: lastErr?.step || "unknown",
    error: "No working API path (404 / HTML)",
    lastErr,
    tried: baseCandidates
  });
}
