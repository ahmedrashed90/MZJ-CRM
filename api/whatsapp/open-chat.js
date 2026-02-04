export default async function handler(req, res) {
  const token = process.env.MERSAL_TOKEN;
  const apiEndpoint = (process.env.MERSAL_API_ENDPOINT || "").replace(/\/+$/g, "");
  if (!token) return res.status(500).json({ ok: false, error: "Missing MERSAL_TOKEN" });
  if (!apiEndpoint) return res.status(500).json({ ok: false, error: "Missing MERSAL_API_ENDPOINT" });

  const normalizeKSA = (v) => {
    let p = String(v || "").replace(/\D/g, "");
    if (p.length === 10 && p.startsWith("05")) p = "966" + p.slice(1);
    if (p.length === 9 && p.startsWith("5")) p = "966" + p;
    if (p.startsWith("00")) p = p.slice(2);
    return p;
  };

  const phoneRaw = String(req.query?.phone || "");
  const phone = normalizeKSA(phoneRaw);
  if (!phone) return res.status(400).json({ ok: false, error: "Missing phone" });

  try {
    const r = await fetch(`${apiEndpoint}/api/wpbox/getContacts?token=${encodeURIComponent(token)}`);
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}

    if (!r.ok || !data) {
      return res.status(500).json({ ok: false, step: "getContacts", status: r.status, error: data || text });
    }

    const contacts = data.contacts || data.data?.contacts || [];
    const pick = (c) => normalizeKSA(c?.phone || c?.mobile || c?.number || "");

    let matches = contacts.filter(c => pick(c) === phone);
    if (!matches.length) {
      const last9 = phone.slice(-9);
      matches = contacts.filter(c => pick(c).endsWith(last9));
    }

    if (!matches.length) return res.status(404).json({ ok: false, error: "Contact not found" });

    const score = (c) => Date.parse(c.updated_at || c.created_at || c.updatedAt || c.createdAt || "") || 0;
    matches.sort((a, b) => score(b) - score(a));

    const contact = matches[0];
    const contactId = contact.id || contact.contact_id;
    if (!contactId) return res.status(500).json({ ok: false, error: "Contact id missing" });

    const chatUrl = `https://w-mersal.com/chat?contact_id=${encodeURIComponent(contactId)}`;
    return res.status(200).json({ ok: true, phone, contact_id: contactId, chat_url: chatUrl });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Unknown error" });
  }
}
