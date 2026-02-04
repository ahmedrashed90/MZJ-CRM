export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const token = process.env.MERSAL_TOKEN;
  const api = (process.env.MERSAL_API_ENDPOINT || "").replace(/\/+$/g, "");

  if (!token) {
    return res.status(500).json({ ok: false, error: "Missing MERSAL_TOKEN" });
  }

  if (!api) {
    return res.status(500).json({ ok: false, error: "Missing MERSAL_API_ENDPOINT" });
  }

  const phoneRaw = String(req.body?.phone || "");
  const phone = phoneRaw.replace(/[^\d+]/g, "");
  if (!phone) {
    return res.status(400).json({ ok: false, error: "Missing phone" });
  }

  const cleanPhone = phone.replace(/\D/g, "");

  async function readJSON(r) {
    const text = await r.text();
    try { return JSON.parse(text); } catch { return null; }
  }

  const bases = [
    `${api}/api/wpbox`,
    `${api}/api/wpbx`
  ];

  try {
    for (const base of bases) {

      // 1️⃣ Get Contacts
      const r1 = await fetch(`${base}/getContacts?token=${encodeURIComponent(token)}`);
      const j1 = await readJSON(r1);

      if (!r1.ok || !j1) continue;

      const contacts = j1.contacts || j1.data?.contacts || [];

      let contact = contacts.find(c => {
        const p = String(c.phone || c.mobile || c.number || "").replace(/\D/g, "");
        return p === cleanPhone;
      });

      // 2️⃣ لو مش موجود اعمل Contact
      if (!contact) {
        const r2 = await fetch(`${base}/makeContact?token=${encodeURIComponent(token)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ phone, name: phone })
        });

        const j2 = await readJSON(r2);
        if (!r2.ok || !j2) continue;

        contact = j2.contact || j2.data?.contact || null;
      }

      const contactId = contact?.id || contact?.contact_id;
      if (!contactId) continue;

      // ✅ الرابط الصحيح لفتح المحادثة في مرسال
      const chatUrl = `https://w-mersal.com/contacts/${contactId}`;

      return res.status(200).json({
        ok: true,
        url: chatUrl,
        contactId,
        usedBase: base
      });
    }

    return res.status(500).json({
      ok: false,
      error: "No working API endpoint found"
    });

  } catch (err) {
    return res.status(500).json({
      ok: false,
      error: err.message
    });
  }
}
