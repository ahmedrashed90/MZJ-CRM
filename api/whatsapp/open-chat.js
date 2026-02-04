export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const phoneRaw = (req.body?.phone || "").toString();
  const phone = phoneRaw.replace(/[^\d+]/g, "");
  if (!phone) return res.status(400).json({ ok: false, error: "Missing phone" });

  const token = process.env.MERSAL_TOKEN;
  if (!token) return res.status(500).json({ ok: false, error: "Missing MERSAL_TOKEN in Vercel env" });

  // لو حطيت MERSAL_API_ENDPOINT في Vercel هيتستخدم الأول
  const envEndpoint = (process.env.MERSAL_API_ENDPOINT || "").trim().replace(/\/+$/g, "");

  // جرّب endpoints محتملة (الأكثر شيوعًا أولًا)
  const candidates = [
    envEndpoint,
    "https://api.w-mersal.com",
    "https://w-mersal.com"
  ].filter(Boolean);

  const cleanPhone = phone.replace(/\D/g, "");

  const readBody = async (r) => {
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) {}
    return { text, json };
  };

  // يجرّب endpoint واحد
  async function tryEndpoint(apiEndpoint) {
    const base = `${apiEndpoint}/api/wpbx`;

    // 1) getContacts
    const url1 = `${base}/getContacts?token=${encodeURIComponent(token)}`;
    const r1 = await fetch(url1);
    const p1 = await readBody(r1);

    // لو 404 أو HTML “لم يتم العثور” يبقى endpoint غلط
    if (!r1.ok) {
      return {
        ok: false,
        step: "getContacts",
        status: r1.status,
        error: p1.json?.message || p1.text?.slice(0, 180) || "getContacts failed",
        apiEndpoint
      };
    }

    const contacts = p1.json?.contacts || p1.json?.data?.contacts || [];
    let contact =
      contacts.find(c => ((c.phone || c.mobile || c.number || "") + "").replace(/\D/g, "") === cleanPhone) || null;

    // 2) makeContact إذا مش موجود
    if (!contact) {
      const url2 = `${base}/makeContact?token=${encodeURIComponent(token)}`;
      const r2 = await fetch(url2, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, name: phone })
      });
      const p2 = await readBody(r2);

      if (!r2.ok) {
        return {
          ok: false,
          step: "makeContact",
          status: r2.status,
          error: p2.json?.message || p2.text?.slice(0, 180) || "makeContact failed",
          apiEndpoint
        };
      }

      contact = p2.json?.contact || p2.json?.data?.contact || null;
    }

    const contactId = contact?.id || contact?.contact_id || null;
    if (!contactId) {
      return {
        ok: false,
        step: "resolveContactId",
        status: 500,
        error: "Contact ID not found",
        apiEndpoint,
        debug: contact
      };
    }

    // ✅ رابط فتح المحادثة داخل مرسال
    const chatUrl = `https://w-mersal.com/chat?contact_id=${encodeURIComponent(contactId)}`;
    return { ok: true, url: chatUrl, contactId, apiEndpoint };
  }

  // جرّب واحد ورا التاني
  let lastErr = null;
  for (const ep of candidates) {
    const out = await tryEndpoint(ep);
    if (out.ok) return res.status(200).json(out);
    lastErr = out;

    // لو اللي حصل 404 غالبًا endpoint غلط فنجرب اللي بعده
    // لو غير كده ممكن يكون توكن/صلاحيات، لكن هنكمل التجربة برضه
  }

  return res.status(500).json({
    ok: false,
    step: lastErr?.step || "unknown",
    error: lastErr?.error || "Failed",
    status: lastErr?.status || 500,
    apiEndpointTried: candidates,
    lastEndpoint: lastErr?.apiEndpoint
  });
}
