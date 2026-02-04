export default async function handler(req, res) {
  if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

  const token = process.env.MERSAL_TOKEN;
  const apiEndpoint = (process.env.MERSAL_API_ENDPOINT || "").replace(/\/+$/g, "");
  if (!token) return res.status(500).json({ ok: false, error: "Missing MERSAL_TOKEN" });
  if (!apiEndpoint) return res.status(500).json({ ok: false, error: "Missing MERSAL_API_ENDPOINT" });

  const contactId = String(req.query?.contact_id || "").trim();
  if (!contactId) return res.status(400).json({ ok: false, error: "Missing contact_id" });

  const isoLike = (s) =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(s) ||
    /^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}/.test(s) ||
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d+Z?$/.test(s);

  const collectStrings = (obj, out, path = "", depth = 0) => {
    if (depth > 6 || obj == null) return;
    const t = typeof obj;
    if (t === "string") {
      const s = obj.trim();
      if (s) out.push({ s, path });
      return;
    }
    if (t !== "object") return;

    if (Array.isArray(obj)) {
      for (let i = 0; i < Math.min(obj.length, 50); i++) {
        collectStrings(obj[i], out, `${path}[${i}]`, depth + 1);
      }
      return;
    }

    for (const k of Object.keys(obj)) {
      collectStrings(obj[k], out, path ? `${path}.${k}` : k, depth + 1);
    }
  };

  const pickTextDeep = (m) => {
    // Priority keys (common message text carriers)
    const priority = [
      "text","message","body","content","caption","msg","message_text","text_message",
      "data.text","data.message","data.body","data.content",
      "payload.text","payload.message","payload.body","payload.content",
      "message.body","message.text","message.content",
      "messages.body","messages.text","messages.content"
    ];

    const getByPath = (o, p) => {
      const parts = p.split(".");
      let cur = o;
      for (const part of parts) {
        if (cur == null) return undefined;
        cur = cur[part];
      }
      return cur;
    };

    for (const p of priority) {
      const v = getByPath(m, p);
      if (typeof v === "string" && v.trim() && !isoLike(v.trim())) return v.trim();
    }

    // Fallback: scan all strings and pick best candidate (non-iso, not too short)
    const strs = [];
    collectStrings(m, strs);

    const filtered = strs
      .map(x => ({...x, s: x.s.trim()}))
      .filter(x => x.s && !isoLike(x.s))
      .filter(x => x.s.length >= 2)
      .filter(x => !/^(ok|true|false|null)$/i.test(x.s));

    if (!filtered.length) return "";

    // Prefer longer strings and those from likely paths
    const score = (x) => {
      let sc = x.s.length;
      if (/text|body|message|content|caption/i.test(x.path)) sc += 50;
      if (/created|updated|date|time|timestamp/i.test(x.path)) sc -= 40;
      return sc;
    };

    filtered.sort((a,b)=>score(b)-score(a));
    return filtered[0].s;
  };

  const pickTime = (m) =>
    (m.time || m.created_at || m.date || m.sent_at || m.timestamp ||
     m?.data?.time || m?.data?.created_at || m?.payload?.created_at || "");

  const pickFromMe = (m) => {
    const v = m.from_me ?? m.mine ?? m.is_me ?? m.me ?? m.fromMe ?? m.fromme ?? m.owner ?? m.isMine ?? m.is_mine;
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

    const raw = (data && (data.messages || data.data?.messages || data.data || data)) || [];
    const arr = Array.isArray(raw) ? raw : (raw.messages || raw.data || []);
    const list = Array.isArray(arr) ? arr : [];

    const debug = String(req.query?.debug || "") === "1";

    const messages = list.map(m => {
      const fromMe = pickFromMe(m);
      const t = pickTextDeep(m);
      const tm = pickTime(m);
      return {
        id: m.id || m.message_id || m.wamid || m.message_wamid || m.uuid || null,
        text: t || "",
        from_me: fromMe,
        direction: fromMe ? "out" : "in",
        time: tm || "",
        ...(debug ? { _raw: m } : {})
      };
    });

    return res.status(200).json({ ok: true, count: messages.length, messages });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e?.message || "Unknown error" });
  }
}
