export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // منع الكاش نهائيًا
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const token = process.env.MERSAL_TOKEN;
  const apiEndpoint = (process.env.MERSAL_API_ENDPOINT || "").replace(/\/+$/g, "");

  if (!token) return res.status(500).json({ ok: false, error: "Missing MERSAL_TOKEN" });
  if (!apiEndpoint) return res.status(500).json({ ok: false, error: "Missing MERSAL_API_ENDPOINT" });

  const contactId = String(req.query?.contact_id || "").trim();
  if (!contactId) return res.status(400).json({ ok: false, error: "Missing contact_id" });

  const TIMEOUT_MS = 15000;
  const MAX = Math.min(Math.max(Number(req.query?.limit || 80), 1), 300);

  const pickTime = (m) =>
    (m.time || m.created_at || m.date || m.sent_at || m.timestamp || "");

  const asMs = (v) => {
    if (!v) return 0;
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : 0;
  };

  const pickTextDeep = (m) => {
    return (
      m.text ||
      m.message ||
      m.body ||
      m.content ||
      m?.data?.text ||
      m?.data?.message ||
      m?.payload?.text ||
      ""
    );
  };

  // 🔥 التعديل المهم: تحديد الرسائل الصادرة بناءً على رقم شركتك داخل النص
  const pickFromMe = (m) => {
    const txt = String(pickTextDeep(m));
    if (txt.includes("920014635")) return true;
    return false;
  };

  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const r = await fetch(`${apiEndpoint}/api/wpbox/getMessages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, contact_id: contactId }),
      signal: controller.signal,
    });

    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch (_) {}

    if (!r.ok) {
      return res.status(500).json({
        ok: false,
        step: "getMessages",
        status: r.status,
        error: data || text,
      });
    }

    const raw = (data && (data.messages || data.data?.messages || data.data || data)) || [];
    const arr = Array.isArray(raw) ? raw : raw.messages || raw.data || [];
    const list = Array.isArray(arr) ? arr : [];

    // ترتيب حسب الوقت
    const sorted = [...list].sort((a, b) => asMs(pickTime(a)) - asMs(pickTime(b)));
    const slice = sorted.slice(-MAX);

    const messages = slice.map((m) => {
      const fromMe = pickFromMe(m);
      return {
        id: m.id || m.message_id || m.wamid || m.uuid || null,
        text: pickTextDeep(m) || "",
        from_me: fromMe,
        direction: fromMe ? "out" : "in",
        time: pickTime(m) || "",
      };
    });

    return res.status(200).json({ ok: true, count: messages.length, messages });
  } catch (e) {
    const isTimeout = String(e?.name || "") === "AbortError";
    return res.status(isTimeout ? 504 : 500).json({
      ok: false,
      error: isTimeout ? `Timeout after ${TIMEOUT_MS}ms (getMessages)` : e?.message || "Unknown error",
    });
  } finally {
    clearTimeout(t);
  }
}
