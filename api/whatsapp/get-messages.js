export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // منع الكاش
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const token = process.env.MERSAL_TOKEN;
  const apiEndpoint = (process.env.MERSAL_API_ENDPOINT || "").replace(/\/+$/g, "");

  if (!token) return res.status(500).json({ ok: false, error: "Missing MERSAL_TOKEN" });
  if (!apiEndpoint) return res.status(500).json({ ok: false, error: "Missing MERSAL_API_ENDPOINT" });

  const contactId = String(req.query?.contact_id || "").trim();
  if (!contactId) return res.status(400).json({ ok: false, error: "Missing contact_id" });

  const MAX = Math.min(Math.max(Number(req.query?.limit || 80), 1), 300);

  const pickTime = (m) =>
    m.time || m.created_at || m.date || m.sent_at || m.timestamp || "";

  const asMs = (v) => {
    if (!v) return 0;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  };

  // استخراج النصوص من أي عمق
  const collectStrings = (obj, out, depth = 0) => {
    if (depth > 6 || obj == null) return;
    if (typeof obj === "string") {
      const s = obj.trim();
      if (s) out.push(s);
      return;
    }
    if (typeof obj !== "object") return;
    if (Array.isArray(obj)) {
      obj.forEach(x => collectStrings(x, out, depth + 1));
    } else {
      Object.values(obj).forEach(x => collectStrings(x, out, depth + 1));
    }
  };

  const isIsoDate = (s) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s);

  const looksLikeId = (s) =>
    /^[A-Za-z0-9+/_=-]{20,}$/.test(s);

  const looksLikeJson = (s) =>
    s.startsWith("{") || s.includes('"type":"reply"');

  // اختيار النص الحقيقي وتنضيفه
  const pickTextDeep = (m) => {
    const strs = [];
    collectStrings(m, strs);

    if (!strs.length) return "";

    const clean = strs.filter(s =>
      s.length > 2 &&
      !s.startsWith("wamid.") &&
      !looksLikeId(s) &&
      !looksLikeJson(s) &&
      !isIsoDate(s)
    );

    if (!clean.length) return "";

    clean.sort((a, b) => b.length - a.length);
    return clean[0];
  };

  // تحديد الرسالة الصادرة من الشركة
  const pickFromMe = (m) => {
    const txt = pickTextDeep(m);
    if (txt.includes("920014635")) return true; // رقم شركتك
    return false;
  };

  try {
    const r = await fetch(`${apiEndpoint}/api/wpbox/getMessages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, contact_id: contactId }),
    });

    const data = await r.json();

    const raw = (data && (data.messages || data.data?.messages || data.data || data)) || [];
    const list = Array.isArray(raw) ? raw : [];

    const sorted = [...list].sort((a, b) => asMs(pickTime(a)) - asMs(pickTime(b)));
    const slice = sorted.slice(-MAX);

    const messages = slice.map((m) => {
      const fromMe = pickFromMe(m);
      return {
        id: m.id || m.message_id || m.wamid || m.uuid || null,
        text: pickTextDeep(m),
        from_me: fromMe,
        direction: fromMe ? "out" : "in",
        time: pickTime(m) || "",
      };
    });

    return res.status(200).json({ ok: true, count: messages.length, messages });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Unknown error" });
  }
}
