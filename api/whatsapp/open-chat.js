export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ ok: false });

  const token = process.env.MERSAL_TOKEN;
  const apiBase = process.env.MERSAL_API_ENDPOINT + "/api/wpbx";

  const phoneRaw = String(req.body?.phone || "");
  const phone = phoneRaw.replace(/[^\d+]/g, "");
  if (!phone) return res.status(400).json({ ok: false, error: "Missing phone" });

  const cleanPhone = phone.replace(/\D/g, "");

  async function getJSON(r){
    const text = await r.text();
    try { return JSON.parse(text); } catch { return null; }
  }

  try {
    // 1️⃣ Get Contacts
    const r1 = await fetch(`${apiBase}/getContacts?token=${token}`);
    const j1 = await getJSON(r1);

    if (!r1.ok || !j1) {
      return res.status(500).json({ ok:false, step:"getContacts", error:j1 || "Bad endpoint" });
    }

    let contact = (j1.contacts || []).find(c =>
      (c.phone || "").replace(/\D/g, "") === cleanPhone
    );

    // 2️⃣ لو مش موجود اعمله Contact
    if (!contact) {
      const r2 = await fetch(`${apiBase}/makeContact?token=${token}`, {
        method:"POST",
        headers:{ "Content-Type":"application/json" },
        body: JSON.stringify({ phone, name: phone })
      });

      const j2 = await getJSON(r2);

      if (!r2.ok || !j2?.contact) {
        return res.status(500).json({ ok:false, step:"makeContact", error:j2 || "Create failed" });
      }

      contact = j2.contact;
    }

    const chatUrl = `https://w-mersal.com/chat?contact_id=${contact.id}`;

    return res.status(200).json({ ok:true, url:chatUrl });

  } catch (err) {
    return res.status(500).json({ ok:false, error:err.message });
  }
}
