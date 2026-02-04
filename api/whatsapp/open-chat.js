export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const phoneRaw = (req.body?.phone || "").toString();
  const phone = phoneRaw.replace(/[^\d+]/g, "");

  if (!phone) return res.status(400).json({ ok: false, error: "Missing phone" });

  const token = process.env.MERSAL_TOKEN;
  const apiEndpoint = (process.env.MERSAL_API_ENDPOINT || "https://api.w-mersal.com").replace(/\/+$/g, "");

  if (!token) return res.status(500).json({ ok: false, error: "Missing MERSAL_TOKEN in Vercel env" });

  const base = `${apiEndpoint}/api/wpbx`;

  const asJson = async (r) => {
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { text, json };
  };

  try {
    // 1) GetContacts
    const url1 = `${base}/getContacts?token=${encodeURIComponent(token)}`;
    const r1 = await fetch(url1);
    const p1 = await asJson(r1);

    if (!r1.ok) {
      return res.status(500).json({
        ok: false,
        step: "getContacts",
        status: r1.status,
        error: p1.json?.message || p1.text || "getContacts failed",
        hint: "Check MERSAL_API_ENDPOINT and token"
      });
    }

    const contacts = p1.json?.contacts || p1.json?.data?.contacts || [];
    const cleanPhone = phone.replace(/\D/g, "");

    let contact =
      contacts.find(c => ((c.phone || c.mobile || c.number || "") + "").replace(/\D/g, "") === cleanPhone) || null;

    // 2) MakeContact if not found
    if (!contact) {
      const url2 = `${base}/makeContact?token=${encodeURIComponent(token)}`;

      // بعض الأنظمة عايزة name + phone
      const r2 = await fetch(url2, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name: phone })
      });

      const p2 = await asJson(r2);

      if (!r2.ok) {
        return res.status(500).json({
          ok: false,
          step: "makeContact",
          status: r2.status,
          error: p2.json?.message || p2.text || "makeContact failed"
        });
      }

      contact = p2.json?.contact || p2.json?.data?.contact || p2.json?.contacts?.[0] || null;
    }

    const contactId = contact?.id || contact?.contact_id || null;

    if (!contactId) {
      return res.status(500).json({
        ok: false,
        step: "resolveContactId",
        error: "Contact ID not found in response",
        debug: { sample: contact }
      });
    }

    // 3) Build chat URL
    // أنت أكدت عندك الشات على /chat
    const chatUrl = `https://w-mersal.com/chat?contact_id=${encodeURIComponent(contactId)}`;

    return res.status(200).json({ ok: true, url: chatUrl, contactId });
  } catch (e) {
    return res.status(500).json({ ok: false, step: "exception", error: e?.message || "Unknown error" });
  }
}
