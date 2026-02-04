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
  const MY_NUMBER = String(process.env.WHATSAPP_MY_NUMBER || "").trim(); // 966920014635

  if (!token) return res.status(500).json({ ok: false, error: "Missing MERSAL_TOKEN" });
  if (!apiEndpoint) return res.status(500).json({ ok: false, error: "Missing MERSAL_API_ENDPOINT" });
  if (!MY_NUMBER) return res.status(500).json({ ok: false, error: "Missing WHATSAPP_MY_NUMBER" });

  const contactId = String(req.query?.contact_id || "").trim();
  if (!contactId) return res.status(400).json({ ok: false, error: "Missing contact_id" });

  const MAX = Math.min(Math.max(Number(req.query?.limit || 80), 1), 300);

  const pickTime = (m) =>
    m?.time || m?.created_at || m?.date || m?.sent_at || m?.timestamp || "";

  // ✅ Fix microseconds: 2026-02-04T15:06:07.000000Z -> 2026-02-04T15:06:07.000Z
  const normalizeIso = (s) => {
    const str = String(s || "").trim();
    const m = str.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d+)(Z)?$/);
    if (!m) return str;
    const base = m[1];
    const frac = (m[2] || "0").padEnd(3, "0").slice(0, 3);
    const z = m[3] || "Z";
    return `${base}.${frac}${z}`;
  };

  const asMs = (v) => {
    if (v == null) return 0;

    if (typeof v === "number") return v > 1e12 ? v : v * 1000;

    const s = String(v).trim();
    if (!s) return 0;

    if (/^\d+$/.test(s)) {
      const n = Number(s);
      return n > 1e12 ? n : n * 1000;
    }

    const t = Date.parse(normalizeIso(s));
    return Number.isFinite(t) ? t : 0;
  };

  const normDigits = (v) => String(v || "").replace(/[^\d]/g, "");
  const MY = normDigits(MY_NUMBER);

  // -------- deep scan helpers --------
  const collectStrings = (obj, out, depth = 0) => {
    if (depth > 8 || obj == null) return;

    const t = typeof obj;

    if (t === "string") {
      const s = obj.trim();
      if (s) out.push(s);
      return;
    }

    if (t !== "object") return;

    if (Array.isArray(obj)) {
      for (let i = 0; i < Math.min(obj.length, 120); i++) {
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

  const looksLikeId = (s) => /^[A-Za-z0-9+/_=-]{20,}$/.test(s);
  const looksLikeWamid = (s) => /^wamid\./i.test(String(s || "").trim());

  const looksEmptyJson = (s) => {
    const t = String(s || "").trim();
    return t === "[]" || t === "{}" || t === "[ ]" || t === "{ }";
  };

  // -------- استخراج Title بتاع زر الرد --------
  const findReplyTitle = (obj, depth = 0) => {
    if (depth > 8 || obj == null) return "";

    if (typeof obj === "object") {
      if (obj.type === "reply" && typeof obj.title === "string" && obj.title.trim()) {
        return obj.title.trim();
      }

      if (obj.reply && typeof obj.reply === "object") {
        const t = findReplyTitle(obj.reply, depth + 1);
        if (t) return t;
      }

      if (obj.parameters && Array.isArray(obj.parameters)) {
        for (const p of obj.parameters) {
          const t = findReplyTitle(p, depth + 1);
          if (t) return t;
        }
      }

      if (typeof obj.title === "string" && obj.title.trim()) {
        if (typeof obj.id === "string" && obj.id.startsWith("btn_")) {
          return obj.title.trim();
        }
      }

      if (Array.isArray(obj)) {
        for (const it of obj) {
          const t = findReplyTitle(it, depth + 1);
          if (t) return t;
        }
      } else {
        for (const k of Object.keys(obj)) {
          const t = findReplyTitle(obj[k], depth + 1);
          if (t) return t;
        }
      }
    }

    return "";
  };

  const fallbackLabel = (m) => {
    let blob = "";
    try {
      blob = JSON.stringify(m || {}).toLowerCase();
    } catch (_) {
      blob = String(m || "").toLowerCase();
    }

    if (blob.includes('"type":"reply"') || blob.includes("buttons") || blob.includes("interactive"))
      return "🔘 رد بزر";

    if (blob.includes("location") || blob.includes('"lat"') || blob.includes('"lng"'))
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

  const cleanText = (s) => {
    let t = String(s || "").trim();

    // أصلح /https://
    t = t.replace(/^\s*\/\s*(https?:\/\/)/i, "$1");

    // شيل القيم الفاضية
    if (looksEmptyJson(t)) return "";

    return t;
  };

  const pickTextDeep = (m) => {
    // 1) reply button title
    const replyTitle = findReplyTitle(m);
    if (replyTitle) return replyTitle;

    // 2) deep strings
    const strs = [];
    collectStrings(m, strs);

    const clean = strs
      .map((x) => cleanText(x))
      .filter((s) =>
        s &&
        s.length > 1 &&
        !looksLikeWamid(s) &&
        !looksLikeId(s) &&
        !isIsoDate(s) &&
        !looksEmptyJson(s)
      );

    if (clean.length) {
      clean.sort((a, b) => b.length - a.length);
      return clean[0];
    }

    // 3) fallback label for media/interactive
    return fallbackLabel(m) || "";
  };

  // تحديد out/in (مع fallback لرسائل النظام)
  const pickFromMe = (m, textMsg) => {
    const direct =
      m?.from_me ?? m?.fromMe ?? m?.mine ?? m?.is_me ?? m?.me ?? m?.owner ??
      m?.key?.fromMe ?? m?.data?.from_me ?? m?.payload?.from_me;

    if (direct !== undefined) return Boolean(direct);

    const candidates = [
      m?.from, m?.sender, m?.author, m?.participant, m?.remoteJid,
      m?.chatId, m?.chat_id,
      m?.data?.from, m?.data?.sender, m?.data?.author,
      m?.payload?.from, m?.payload?.sender,
      m?.message?.from, m?.message?.author,
      m?.key?.participant, m?.key?.remoteJid,
    ].filter(Boolean);

    if (candidates.some((v) => normDigits(v).includes(MY))) return true;

    // fallback لرسائل النظام اللي بتطلع من المودال
    const t = String(textMsg || "");
    if (t.includes("920014635")) return true;
    if (t.includes("mzj-crm.vercel.app")) return true;
    if (t.includes("mzj-tracking.vercel.app")) return true;

    return false;
  };

  try {
    const r = await fetch(`${apiEndpoint}/api/wpbox/getMessages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, contact_id: contactId }),
    });

    const rawText = await r.text();
    let data = null;
    try { data = JSON.parse(rawText); } catch (_) {}

    if (!r.ok) {
      return res.status(500).json({
        ok: false,
        step: "getMessages",
        status: r.status,
        error: data || rawText,
      });
    }

    const raw = (data && (data.messages || data.data?.messages || data.data || data)) || [];
    const arr = Array.isArray(raw) ? raw : (raw.messages || raw.data || []);
    const list = Array.isArray(arr) ? arr : [];

    // ✅ SORT ثابت: الأقدم -> الأحدث (مع tie-breaker)
    const sorted = [...list].sort((a, b) => {
      const ta = asMs(pickTime(a));
      const tb = asMs(pickTime(b));
      if (ta !== tb) return ta - tb;

      const ia = Number(a?.id || a?.message_id || 0) || 0;
      const ib = Number(b?.id || b?.message_id || 0) || 0;
      return ia - ib;
    });

    // آخر MAX فقط لكن بنفس ترتيب الأقدم->الأحدث
    const slice = sorted.slice(Math.max(0, sorted.length - MAX));

    const messages = slice
      .map((m) => {
        const msgText = pickTextDeep(m);
        const cleaned = cleanText(msgText);

        const fromMe = pickFromMe(m, cleaned);

        return {
          id: m?.id || m?.message_id || m?.wamid || m?.uuid || null,
          text: cleaned,
          from_me: fromMe,
          direction: fromMe ? "out" : "in",
          time: pickTime(m) || "",
        };
      })
      .filter((x) => String(x.text || "").trim().length > 0);

    return res.status(200).json({ ok: true, count: messages.length, messages });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Unknown error" });
  }
}
