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
  const MY_NUMBER = String(process.env.WHATSAPP_MY_NUMBER || "").trim(); // مثال: 966920014635

  if (!token) return res.status(500).json({ ok: false, error: "Missing MERSAL_TOKEN" });
  if (!apiEndpoint) return res.status(500).json({ ok: false, error: "Missing MERSAL_API_ENDPOINT" });
  if (!MY_NUMBER) return res.status(500).json({ ok: false, error: "Missing WHATSAPP_MY_NUMBER" });

  const contactId = String(req.query?.contact_id || "").trim();
  if (!contactId) return res.status(400).json({ ok: false, error: "Missing contact_id" });

  const TIMEOUT_MS = Math.min(Math.max(Number(req.query?.timeout_ms || 15000), 2000), 60000);
  const LIMIT = Math.min(Math.max(Number(req.query?.limit || 120), 1), 300);

  // 2026-02-04T15:06:07.000000Z -> 2026-02-04T15:06:07.000Z
  const normalizeIso = (s) => {
    const str = String(s || "").trim();
    const m = str.match(/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d+)(Z)?$/);
    if (!m) return str;
    const base = m[1];
    const frac = (m[2] || "0").padEnd(3, "0").slice(0, 3);
    const z = m[3] || "Z";
    return `${base}.${frac}${z}`;
  };

  const parseTimeMs = (raw) => {
    if (raw == null) return 0;
    if (typeof raw === "number") return raw > 1e12 ? raw : raw * 1000;
    const s0 = String(raw).trim();
    if (!s0) return 0;

    if (/^\d{10,13}$/.test(s0)) {
      const n = Number(s0);
      return n > 1e12 ? n : n * 1000;
    }

    const t = Date.parse(normalizeIso(s0));
    return Number.isFinite(t) ? t : 0;
  };

  const normDigits = (v) => String(v || "").replace(/[^\d]/g, "");
  const MY = normDigits(MY_NUMBER);

  const looksLikeWamid = (s) => {
    const t = String(s || "").trim();
    return /^=+wamid\./i.test(t) || /^wamid\./i.test(t);
  };

  const looksEmptyJson = (s) => {
    const t = String(s || "").trim();
    return t === "[]" || t === "{}" || t === "[ ]" || t === "{ }";
  };

  const isIsoLike = (s) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s) ||
    /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(s);

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

  // استخراج عنوان زر الرد لو موجود (reply buttons)
  const findReplyTitle = (obj, depth = 0) => {
    if (depth > 8 || obj == null) return "";

    if (typeof obj === "object") {
      if (obj.type === "reply" && typeof obj.title === "string" && obj.title.trim()) {
        return obj.title.trim();
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

  const cleanText = (s) => {
    let t = String(s || "").trim();
    t = t.replace(/^\s*\/\s*(https?:\/\/)/i, "$1"); // /https:// -> https://
    if (looksEmptyJson(t)) return "";
    return t;
  };

  const pickTextDeep = (m) => {
    // 1) reply title
    const rt = findReplyTitle(m);
    if (rt) return rt;

    // 2) try common paths
    const candidates = [
      m?.text,
      m?.message,
      m?.body,
      m?.content,
      m?.caption,
      m?.data?.text,
      m?.data?.message,
      m?.payload?.text,
      m?.payload?.message,
      m?.message?.text,
      m?.message?.body,
      m?.message?.content
    ].filter((x) => typeof x === "string" && x.trim());

    for (const c of candidates) {
      const t = cleanText(c);
      if (t && !isIsoLike(t) && !looksLikeWamid(t)) return t;
    }

    // 3) deep scan
    const strs = [];
    collectStrings(m, strs);

    const filtered = strs
      .map(cleanText)
      .filter((s) => s && !isIsoLike(s) && !looksLikeWamid(s))
      .filter((s) => !/^(true|false|null)$/i.test(s));

    if (!filtered.length) {
      // 4) fallback قوي: استخرج أي مقطع عربي من الرسالة حتى لو قصير
      try {
        const blob = JSON.stringify(m || {});
        const ar = (blob.match(/[\u0600-\u06FF]{1,}/g) || [])
          .map(s => s.trim())
          .filter(Boolean);

        if (ar.length) {
          ar.sort((a,b)=> b.length - a.length);
          return ar[0];
        }
      } catch(e) {}
      return "";
    }

    // score: prefer longer strings but avoid obvious IDs
    const score = (s) => {
      let sc = s.length;
      if (/^https?:\/\//i.test(s)) sc += 20; // الروابط مهمة
      if (/text|body|message|content|caption/i.test(JSON.stringify(m || ""))) sc += 0;
      return sc;
    };

    filtered.sort((a, b) => score(b) - score(a));
    return filtered[0];
  };

  const pickTimeRaw = (m) =>
    (m.time || m.created_at || m.date || m.sent_at || m.timestamp || m?.data?.time || m?.data?.created_at || m?.payload?.created_at || "");

  const pickFromMe = (m, textMsg) => {
    // flags صريحة
    const direct = m.from_me ?? m.fromMe ?? m.mine ?? m.is_me ?? m.me ?? m.owner ?? m.isMine ?? m.is_mine ?? m?.key?.fromMe ?? m?.data?.from_me ?? m?.payload?.from_me;
    if (direct !== undefined) return Boolean(direct);

    // لو المزود بيرجع اتجاه صريح
    const dir = (m.direction || m.dir || m?.data?.direction || m?.payload?.direction || m?.message?.direction || "").toString().toLowerCase();
    if (dir === "out" || dir === "outgoing" || dir === "sent" || dir === "send") return true;
    if (dir === "in" || dir === "incoming" || dir === "recv" || dir === "received") return false;

    // لو فيه type/status صريحين
    const typeStr = (m.type || m.msg_type || m?.data?.type || m?.payload?.type || "").toString().toLowerCase();
    if (typeStr.includes("out")) return true;
    if (typeStr.includes("in")) return false;

    const statusStr = (m.status || m?.data?.status || m?.payload?.status || "").toString().toLowerCase();
    if (statusStr.includes("out")) return true;
    if (statusStr.includes("in")) return false;

    // فحص عام (احتياطي) لو ظهر في الـ raw أي علامة out
    try{
      const blob = JSON.stringify(m || {}).toLowerCase();
      if (blob.includes('"direction":"out"') || blob.includes('"from_me":true') || blob.includes('"fromme":true') || blob.includes('"key":{"fromme":true')) return true;
      if (blob.includes('"direction":"in"') || blob.includes('"from_me":false') || blob.includes('"fromme":false')) return false;
    }catch(_){}

    // حقول هوية المرسل المحتملة
    const candidates = [
      m?.from, m?.sender, m?.author, m?.participant, m?.remoteJid,
      m?.chatId, m?.chat_id,
      m?.data?.from, m?.data?.sender, m?.data?.author,
      m?.payload?.from, m?.payload?.sender,
      m?.message?.from, m?.message?.author,
      m?.key?.participant, m?.key?.remoteJid
    ].filter(Boolean);

    if (candidates.some((v) => normDigits(v).includes(MY))) return true;

    // fallback لرسائل النظام (تجاربك من المودال)
    const t = String(textMsg || "");
    if (t.includes("920014635")) return true;
    if (t.includes("mzj-crm.vercel.app")) return true;
    if (t.includes("mzj-tracking.vercel.app")) return true;

    return false;
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const r = await fetch(`${apiEndpoint}/api/wpbox/getMessages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, contact_id: contactId }),
      signal: controller.signal
    });

    // اقرأ البايتات الخام (حل مشكلة Encoding العربي من مزوّد مرسال)
    const buffer = await r.arrayBuffer();
    const rawText = new TextDecoder("utf-8").decode(buffer);

    let data = null;
    try { data = JSON.parse(rawText); } catch (e) {
      console.error("JSON parse error:", e, rawText.slice(0, 500));
    }

    if (!r.ok) {
      return res.status(500).json({ ok: false, step: "getMessages", status: r.status, error: data || rawText });
    }

    const raw = (data && (data.messages || data.data?.messages || data.data || data)) || [];
    const arr = Array.isArray(raw) ? raw : (raw.messages || raw.data || []);
    const list = Array.isArray(arr) ? arr : [];

    const normalized = list.map((m) => {
      const txt = pickTextDeep(m);
      const tm = pickTimeRaw(m);
      const fromMe = pickFromMe(m, txt);

      return {
        id: m.id || m.message_id || m.wamid || m.message_wamid || m.uuid || null,
        text: txt || "",
        from_me: fromMe,
        direction: fromMe ? "out" : "in",
        time: tm || "",
        _t: parseTimeMs(tm)
      };
    }).filter((x) => {
      const t = String(x.text || '').trim();
      if(!t) return false;
      // hide internal label if it appears
      if(t === 'المدير') return false;
      return true;
    });

    // sort ثابت: الأقدم -> الأحدث (مع tie-breaker بالـ id)
    normalized.sort((a, b) => {
      const ta = a._t || 0;
      const tb = b._t || 0;
      if (ta !== tb) return ta - tb;

      const ia = Number(a.id || 0) || 0;
      const ib = Number(b.id || 0) || 0;
      return ia - ib;
    });

    const sliced = normalized
      .slice(Math.max(0, normalized.length - LIMIT))
      .map(({ _t, ...rest }) => rest);

    return res.status(200).json({ ok: true, count: sliced.length, messages: sliced });
  } catch (e) {
    const isTimeout = String(e?.name || "") === "AbortError";
    return res.status(isTimeout ? 504 : 500).json({
      ok: false,
      error: isTimeout ? `Timeout after ${TIMEOUT_MS}ms (getMessages)` : (e?.message || "Unknown error")
    });
  } finally {
    clearTimeout(timer);
  }
}
