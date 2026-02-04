export default async function handler(req, res) {
  const token = process.env.MERSAL_TOKEN;
  const api = (process.env.MERSAL_API_ENDPOINT || "").replace(/\/+$/g, "");

  if (!token) return res.status(500).json({ ok: false, error: "Missing MERSAL_TOKEN" });
  if (!api) return res.status(500).json({ ok: false, error: "Missing MERSAL_API_ENDPOINT" });

  const phoneRaw = String(req.query?.phone || req.body?.phone || "");
  const phone = phoneRaw.replace(/\D/g, "");
  if (!phone) return res.status(400).json({ ok: false, error: "Missing phone" });

  const last9 = phone.slice(-9);

  async function readJson(resp) {
    const text = await resp.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { text, json };
  }

  try {
    // 1) getContacts
    const r1 = await fetch(`${api}/api/wpbox/getContacts?token=${encodeURIComponent(token)}`);
    const p1 = await readJson(r1);

    if (!r1.ok || !p1.json) {
      return res.status(500).json({
        ok: false,
        step: "getContacts",
        status: r1.status,
        error: p1.json || p1.text?.slice(0, 200) || "Bad response",
      });
    }

    const contacts = p1.json.contacts || p1.json.data?.contacts || [];
    let contact = contacts.find((c) => {
      const p = String(c.phone || c.mobile || c.number || "").replace(/\D/g, "");
      return p.endsWith(last9);
    });

    // 2) لو مش موجود: makeContact
    if (!contact) {
      const r2 = await fetch(`${api}/api/wpbox/makeContact?token=${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone }),
      });
      const p2 = await readJson(r2);

      if (!r2.ok || !p2.json) {
        return res.status(500).json({
          ok: false,
          step: "makeContact",
          status: r2.status,
          error: p2.json || p2.text?.slice(0, 200) || "Create failed",
        });
      }

      contact = p2.json.contact || p2.json.data?.contact || null;
    }

    const contactId = contact?.id || contact?.contact_id;
    if (!contactId) {
      return res.status(500).json({ ok: false, step: "resolveContactId", error: "No contact id" });
    }

    const chatUrl = `https://w-mersal.com/chat?contact_id=${encodeURIComponent(contactId)}`;
    return res.status(200).json({ ok: true, contact_id: contactId, chat_url: chatUrl });
  } catch (e) {
    return res.status(500).json({ ok: false, step: "exception", error: e?.message || "Unknown error" });
  }
}
