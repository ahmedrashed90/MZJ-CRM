export default async function handler(req, res) {
  // Allow only GET
  if (req.method !== "GET") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  // No cache (important on Vercel)
  res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Expires", "0");

  const token = process.env.MERSAL_TOKEN;
  const apiEndpoint = (process.env.MERSAL_API_ENDPOINT || "").replace(/\/+$/g, "");
  const MY_NUMBER = String(process.env.WHATSAPP_MY_NUMBER || "").trim(); // e.g. 9665XXXXXXX (no +)

  if (!token) return res.status(500).json({ ok: false, error: "Missing MERSAL_TOKEN" });
  if (!apiEndpoint) return res.status(500).json({ ok: false, error: "Missing MERSAL_API_ENDPOINT" });
  if (!MY_NUMBER) return res.status(500).json({ ok: false, error: "Missing WHATSAPP_MY_NUMBER" });

  const contactId = String(req.query?.contact_id || "").trim();
  if (!contactId) return res.status(400).json({ ok: false, error: "Missing contact_id" });

  const TIMEOUT_MS = Math.min(Math.max(Number(req.query?.timeout_ms || 15000), 2000), 60000);
  const MAX = Math.min(Math.max(Number(req.query?.limit || 80), 1), 300);

  // Helpers
  const normDigits = (x) => String(x || "").replace(/[^\d]/g, "");
  const MY = normDigits(MY_NUMBER);

  const isIsoLike = (s) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s) ||
    /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(s) ||
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z?$/.test(s);

  const looksLikeWamid = (s) => /^wamid\./i.test(String(s || "").trim());

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

  const pickTime = (m) =>
    (m.time ||
      m.created_at ||
      m.date ||
      m.sent_at ||
      m.timestamp ||
      m?.data?.time ||
      m?.data?.created_at ||
      m?.payload?.created_at ||
      m?.message?.created_at ||
      "");

  const collectStrings = (obj, out, path = "", depth = 0) => {
    if (depth > 7 || obj == null) return;
    const t = typeof obj;

    if (t === "string") {
      const s = obj.trim();
      if (s) out.push({ s, path });
      return;
    }

    if (t !== "object") return;

    if (Array.isArray(obj)) {
      for (let i = 0; i < Math.min(obj.length, 60); i++) {
        collectStrings(obj[i], out, `${path}[${i}]`, depth + 1);
      }
      return;
    }

    for (const k of Object.keys(obj)) {
      collectStrings(obj[k], out, path ? `${path}.${k}` : k, depth + 1);
    }
  };

  const getByPath = (o, p) => {
    const parts = p.split(".");
    let cur = o;
    for (const part of parts) {
      if (cur == null) return undefined;
      cur = cur[part];
    }
    return cur;
  };

  const tryParseJsonString = (s) => {
    if (typeof s !== "string") return null;
    const t = s.trim();
    if (!t) return null;
    if (!(t.startsWith("{") || t.startsWith("["))) return null;
    try {
      return JSON.parse(t);
    } catch (_) {
      return null;
    }
  };

  const pickTextDeep = (m) => {
    // 1) direct priority paths
    const priority = [
      "text",
      "message",
      "body",
      "content",
      "caption",
      "msg",
      "message_text",
      "text_message",

      "data.text",
      "data.message",
      "data.body",
      "data.content",

      "payload.text",
      "payload.message",
      "payload.body",
      "payload.content",

      "message.body",
      "message.text",
      "message.content",
    ];

    for (const p of priority) {
      const v = getByPath(m, p);
      if (typeof v === "string") {
        const s = v.trim();
        if (!s) continue;
        if (isIsoLike(s)) continue;
        if (looksLikeWamid(s)) continue;

        // sometimes the provider returns JSON as a string
        const parsed = tryParseJsonString(s);
        if (parsed) {
          const deep = pickTextDeep(parsed);
          if (deep) return deep;
        }

        return s;
      }
    }

    // 2) deep scan all strings
    const strs = [];
    collectStrings(m, strs);

    const filtered = strs
      .map((x) => ({ ...x, s: x.s.trim() }))
      .filter((x) => x.s && !isIsoLike(x.s))
      .filter((x) => x.s.length >= 2)
      .filter((x) => !looksLikeWamid(x.s))
      .filter((x) => !/^(ok|true|false|null)$/i.test(x.s));

    if (!filtered.length) return "";

    const score = (x) => {
      let sc = x.s.length;
      if (/text|body|message|content|caption/i.test(x.path)) sc += 80;
      if (/created|updated|date|time|timestamp/i.test(x.path)) sc -= 60;
      if (/wamid/i.test(x.s)) sc -= 200;
      return sc;
    };

    filtered.sort((a, b) => score(b) - score(a));

    // if top is JSON string, try parse and pick again
    const top = filtered[0].s;
    const parsed = tryParseJsonString(top);
    if (parsed) {
      const deep = pickTextDeep(parsed);
      if (deep) return deep;
    }

    return top;
  };

  // MAIN FIX: determine from_me for ALL clients using your WhatsApp number/session
  const pickFromMe = (m) => {
    // If provider gives an explicit flag, trust it
    const direct =
      m.from_me ??
      m.fromMe ??
      m.fromme ??
      m.mine ??
      m.is_me ??
      m.me ??
      m.owner ??
      m.isMine ??
      m.is_mine ??
      m?.key?.fromMe ??
      m?.data?.from_me ??
      m?.payload?.from_me;

    if (direct !== undefined) return Boolean(direct);

    // Otherwise search for sender identity fields
    const candidates = [
      m.from,
      m.sender,
      m.author,
      m.source,
      m.participant,
      m.remoteJid,
      m.chatId,
      m.chat_id,
      m.user,
      m.user_id,
      m.session,
      m.session_id,
      m?.data?.from,
      m?.data?.sender,
      m?.data?.author,
      m?.payload?.from,
      m?.payload?.sender,
      m?.message?.from,
      m?.message?.author,
      m?.key?.participant,
      m?.key?.remoteJid,
    ].filter(Boolean);

    // If any candidate contains your number => it's outgoing
    return candidates.some((v) => normDigits(v).includes(MY));
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
    try {
      data = JSON.parse(text);
    } catch (_) {}

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

    // sort by time (newest first), then take MAX newest
    const sorted = [...list].sort((a, b) => asMs(pickTime(b)) - asMs(pickTime(a)));
    const slice = sorted.slice(0, MAX).reverse(); // return oldest->newest for UI

    const messages = slice.map((m) => {
      const fromMe = pickFromMe(m);
      const txt = pickTextDeep(m);
      const tm = pickTime(m);

      return {
        id: m.id || m.message_id || m.wamid || m.message_wamid || m.uuid || null,
        text: txt || "",
        from_me: fromMe,
        direction: fromMe ? "out" : "in",
        time: tm || "",
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
