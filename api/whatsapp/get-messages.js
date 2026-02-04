export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const token = process.env.MERSAL_TOKEN;
  const apiEndpoint = (process.env.MERSAL_API_ENDPOINT || "").replace(/\/+$/g, "");
  if (!token) return res.status(500).json({ ok: false, error: "Missing MERSAL_TOKEN" });
  if (!apiEndpoint) return res.status(500).json({ ok: false, error: "Missing MERSAL_API_ENDPOINT" });

  const contactId = String(req.query?.contact_id || "").trim();
  if (!contactId) return res.status(400).json({ ok: false, error: "Missing contact_id" });

  const pickText = (m) => {
    const candidates = [
      m.text, m.message, m.body, m.content, m.caption, m.msg, m.message_text, m.text_message,
      m?.data?.text, m?.data?.message, m?.payload?.text, m?.payload?.message
    ].filter(v => typeof v === "string" && v.trim().length);

    if (!candidates.length) return "";

    // If the first candidate looks like an ISO date (common bug), try to find a better one
    const isoLike = (s) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s) || /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(s);
    if (isoLike(candidates[0])) {
      const better = candidates.find(s => !isoLike(s));
      return (better || candidates[0]).trim();
    }
    return candidates[0].trim();
  };

  const pickTime = (m) => {
    return (
      m.time || m.created_at || m.date || m.sent_at || m.timestamp ||
      m?.data?.time || m?.data?.created_at || ""
    );
  };

  const pickFromMe = (m) => {
    const v = m.from_me ?? m.mine ?? m.is_me ?? m.me ?? m.fromMe ?? m.fromme ?? m.owner;
    return Boolean(v);
  };

  try {
    const r = await fetch(`${apiEndpoint}/api/wpbox/getMessages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, contact_id: contactId })
    });

    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}

    if (!r.ok) {
      return res.status(500).json({ ok: false, step: "getMessages", status: r.status, error: data || text });
    }

    // Try multiple shapes for messages list
    const raw =
      (data && (data.messages || data.data?.messages || data.data || data)) || [];
    const arr = Array.isArray(raw) ? raw : (raw.messages || raw.data || []);
    const list = Array.isArray(arr) ? arr : [];

    const messages = list.map(m => {
      const fromMe = pickFromMe(m);
      const t = pickText(m);
      const tm = pickTime(m);
      return {
        id: m.id || m.message_id || m.wamid || m.message_wamid || m.uuid || null,
        text: t || (m.type && m.type !== "text" ? `[${m.type}]` : ""),
        from_me: fromMe,
        direction: fromMe ? "out" : "in",
        time: tm || ""
      };
    });

    return res.status(200).json({ ok: true, messages });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Unknown error" });
  }
}
