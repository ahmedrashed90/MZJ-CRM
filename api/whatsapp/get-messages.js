export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // منع الكاش (مهم على Vercel)
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const token = process.env.MERSAL_TOKEN;
  const apiEndpoint = (process.env.MERSAL_API_ENDPOINT || "").replace(/\/+$/g, "");
  const MY_NUMBER = String(process.env.WHATSAPP_MY_NUMBER || "").trim();

  if (!token) return res.status(500).json({ ok: false, error: "Missing MERSAL_TOKEN" });
  if (!apiEndpoint) return res.status(500).json({ ok: false, error: "Missing MERSAL_API_ENDPOINT" });
  if (!MY_NUMBER) return res.status(500).json({ ok: false, error: "Missing WHATSAPP_MY_NUMBER" });

  const contactId = String(req.query?.contact_id || "").trim();
  if (!contactId) return res.status(400).json({ ok: false, error: "Missing contact_id" });

  const MAX = Math.min(Math.max(Number(req.query?.limit || 80), 1), 300);

  const pickTime = (m) =>
    m?.time || m?.created_at || m?.date || m?.sent_at || m?.timestamp || "";

  const asMs = (v) => {
    if (v == null) return 0;

    if (typeof v === "number") return v > 1e12 ? v : v * 1000;

    const s = String(v).trim();
    if (!s) return 0;

    if (/^\d+$/.test(s)) {
      const n = Number(s);
      return n > 1e12 ? n : n * 1000;
    }

    const t = Date.parse(s);
    return Number.isFinite(t) ? t : 0;
  };

  // ---- Deep string extraction ----
  const collectStrings = (obj, out, depth = 0) => {
    if (depth > 7 || obj == null) return;

    const t = typeof obj;

    if (t === "string") {
      const s = obj.trim();
      if (s) out.push(s);
      return;
    }

    if (t !== "object") return;

    if (Array.isArray(obj)) {
      for (let i = 0; i < Math.min(obj.length, 80); i++) {
        collectStrings(obj[i], out, depth + 1);
      }
      return;
    }

    for (const k of Object.keys(obj)) {
      collectStrings(obj[k], out, depth + 1);
    }
  };

  const isIsoDate = (s) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s) ||
    /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(s);

  const looksLikeId = (s) =>
    /^[A-Za-z0-9+/_=-]{20,}$/.test(s);

  const looksLikeJson = (s) =>
    s.startsWith("{") || s.includes('"type":"reply"');

  const looksLikeWamid = (s) =>
    /^wamid\./i.test(String(s || "").trim());

  // لو مفيش نص: رجّع وصف محترم (بدل "لا يوجد نص...")
  const fallbackLabel = (m) => {
    let blob = "";
    try {
      blob = JSON.stringify(m || {}).toLowerCase();
    } catch (_) {
      blob = String(m || "").toLowerCase();
    }

    if (blob.includes('"type":"reply"') || blob.includes("buttons") || blob.includes("interactive"))
      return "🔘 رسالة بأزرار";

    if (blob.includes("location") || blob.includes("latitude") || blob.includes("longitude") || blob.includes('"lat"') || blob.includes('"lng"'))
      return "📍 موقع";

    if (blob.includes("image") || blob.includes("jpg") || blob.includes("jpeg") || blob.includes("png") || blob.includes("webp"))
      return "📷 صورة";

    if (blob.includes("video") || blob.includes("mp4") || blob.includes("mov") || blob.includes("mkv"))
      return "🎥 فيديو";

    if (blob.includes("audio") || blob.includes("voice") || blob.includes("ogg") || blob.includes("mp3") || blob.includes("wav"))
      return "🎙️ رسالة صوتية";

    if (blob.includes("document") || blob.includes("file") || blob.includes("pdf") || blob.includes("doc") || blob.includes("xls") || blob.includes("ppt"))
      return "📎 ملف";

    if (blob.includes("reaction") || blob.includes("emoji"))
      return "😊 تفاعل";

    return "";
  };

  // اختيار النص الحقيقي (أو label لو غير نصي)
  const pickTextDeep = (m) => {
    const strs = [];
    collectStrings(m, strs);

    const clean = strs
      .map((s) => s.trim())
      .filter((s) =>
        s.length > 1 &&
        !looksLikeWamid(s) &&
        !looksLikeId(s) &&
        !looksLikeJson(s) &&
        !isIsoDate(s)
      );

    if (clean.length) {
      clean.sort((a, b) => b.length - a.length);
      return clean[0];
    }

    return fallbackLabel(m) || "";
  };

  // ---- MAIN FIX: detect outgoing using WHATSAPP_MY_NUMBER ----
  const normDigits = (v) => String(v || "").replace(/[^\d]/g, "");
  const MY = normDigits(MY_NUMBER);

  const pickFromMe = (m) => {
    // flags صريحة لو موجودة
    const direct =
      m?.from_me ?? m?.fromMe ?? m?.fromme ??
      m?.mine ?? m?.is_me ?? m?.me ?? m?.owner ??
      m?.isMine ?? m?.is_mine ??
      m?.key?.fromMe ??
      m?.data?.from_me ?? m?.payload?.from_me;

    if (direct !== undefined) return Boolean(direct);

    // حقول هوية المرسل المحتملة
    const candidates = [
      m?.from, m?.sender, m?.author, m?.participant, m?.remoteJid,
      m?.chatId, m?.chat_id,
      m?.data?.from, m?.data?.sender, m?.data?.author,
      m?.payload?.from, m?.payload?.sender,
      m?.message?.from, m?.message?.author,
      m?.key?.participant, m?.key?.remoteJid,
    ].filter(Boolean);

    if (candidates.some((v) => normDigits(v).includes(MY))) return true;

    // fallback أخير: فتش جوه الـ object كله
    let blob = "";
    try { blob = JSON.stringify(m || ""); } catch (_) {}
    return normDigits(blob).includes(MY);
  };

  try {
    const r = await fetch(`${apiEndpoint}/api/wpbox/getMessages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, contact_id: contactId }),
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
    const arr = Array.isArray(raw) ? raw : (raw.messages || raw.data || []);
    const list = Array.isArray(arr) ? arr : [];

    // ترتيب زمني + آخر MAX
    const sorted = [...list].sort((a, b) => asMs(pickTime(a)) - asMs(pickTime(b)));
    const slice = sorted.slice(-MAX);

    const messages = slice
      .map((m) => {
        const txt = pickTextDeep(m);

        // تنظيف بداية اللينك لو ظهر "/https://"
        const cleanedText = String(txt || "").replace(/^\/https?:\/\//, (x) => x.slice(1));

        const fromMe = pickFromMe(m);
        return {
          id: m?.id || m?.message_id || m?.wamid || m?.uuid || null,
          text: cleanedText,
          from_me: fromMe,
          direction: fromMe ? "out" : "in",
          time: pickTime(m) || "",
        };
      })
      // لو لسه فاضي بعد كل ده، اشيله بدل ما يظهر placeholder في الواجهة
      .filter((x) => String(x.text || "").trim().length > 0);

    return res.status(200).json({ ok: true, count: messages.length, messages });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Unknown error" });
  }
}
