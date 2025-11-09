
import express from "express";
import crypto from "crypto";
import fetch from "node-fetch";
import cors from "cors";
import pg from "pg";

const { Pool } = pg;
const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

const {
  PORT = 3001,
  DATABASE_URL,
  JWT_SECRET,
  META_APP_ID, META_APP_SECRET, META_VERIFY_TOKEN, META_REDIRECT_URI,
  TIKTOK_CLIENT_KEY, TIKTOK_CLIENT_SECRET, TIKTOK_REDIRECT_URI,
  SNAP_CLIENT_ID, SNAP_CLIENT_SECRET, SNAP_REDIRECT_URI,
  ENCRYPTION_KEY_32B
} = process.env;

const pool = new Pool({ connectionString: DATABASE_URL });

function getKey() {
  let buf;
  try { buf = Buffer.from(ENCRYPTION_KEY_32B, "base64"); } catch {}
  if (!buf || buf.length !== 32) {
    try { buf = Buffer.from(ENCRYPTION_KEY_32B, "hex"); } catch {}
  }
  if (!buf || buf.length !== 32) {
    const raw = Buffer.from(ENCRYPTION_KEY_32B || "", "utf8");
    buf = Buffer.alloc(32);
    raw.copy(buf);
  }
  return buf;
}
const KEY = getKey();

function enc(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", KEY, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64");
}
function dec(payload) {
  const raw = Buffer.from(payload, "base64");
  const iv = raw.subarray(0,12);
  const tag = raw.subarray(12,28);
  const data = raw.subarray(28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", KEY, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(data), decipher.final()]);
  return dec.toString("utf8");
}

async function upsertAccount({ platform, external_account_id, name, access_token, refresh_token, token_expires_at }) {
  const q = `
    INSERT INTO accounts (platform, external_account_id, name, access_token, refresh_token, token_expires_at)
    VALUES ($1,$2,$3,$4,$5,$6)
    ON CONFLICT (platform, external_account_id)
    DO UPDATE SET name=EXCLUDED.name, access_token=EXCLUDED.access_token,
                  refresh_token=EXCLUDED.refresh_token, token_expires_at=EXCLUDED.token_expires_at,
                  updated_at=now()
    RETURNING id;
  `;
  const v = [platform, external_account_id, name || null, enc(access_token), refresh_token ? enc(refresh_token) : null, token_expires_at];
  const { rows } = await pool.query(q, v);
  return rows[0].id;
}

async function insertLead(l) {
  const q = `
    INSERT INTO leads (platform, external_lead_id, form_id, campaign_id, adset_id, ad_id,
      full_name, phone, email, fields, created_at, source_account)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
    ON CONFLICT (external_lead_id) DO NOTHING;
  `;
  const v = [
    l.platform, l.external_lead_id, l.form_id || null, l.campaign_id || null, l.adset_id || null, l.ad_id || null,
    l.full_name || null, l.phone || null, l.email || null, l.fields || {}, l.created_at, l.source_account
  ];
  await pool.query(q, v);
}

// Meta OAuth
app.get("/auth/meta", (req, res) => {
  const scopes = [
    "pages_show_list","pages_read_engagement","leads_retrieval",
    "pages_manage_metadata","business_management","ads_management"
  ].join(",");
  const url = `https://www.facebook.com/v21.0/dialog/oauth?client_id=${META_APP_ID}&redirect_uri=${encodeURIComponent(META_REDIRECT_URI)}&scope=${encodeURIComponent(scopes)}`;
  res.redirect(url);
});
app.get("/auth/meta/callback", async (req, res) => {
  try {
    const code = req.query.code;
    const tokenRes = await fetch(`https://graph.facebook.com/v21.0/oauth/access_token?client_id=${META_APP_ID}&client_secret=${META_APP_SECRET}&redirect_uri=${encodeURIComponent(META_REDIRECT_URI)}&code=${code}`);
    const token = await tokenRes.json();
    const pagesRes = await fetch(`https://graph.facebook.com/v21.0/me/accounts?access_token=${token.access_token}`);
    const pages = await pagesRes.json();
    for (const p of pages.data || []) {
      await upsertAccount({ platform: "meta", external_account_id: p.id, name: p.name, access_token: p.access_token });
    }
    res.send("Meta connected ✅");
  } catch (e) {
    console.error(e);
    res.status(500).send("Meta connect error");
  }
});
app.get("/webhooks/meta", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === META_VERIFY_TOKEN) return res.status(200).send(challenge);
  res.sendStatus(403);
});
app.post("/webhooks/meta", async (req, res) => {
  try {
    const entries = req.body.entry || [];
    for (const entry of entries) {
      for (const ch of entry.changes || []) {
        if (ch.field === "leadgen") {
          const leadId = ch.value?.leadgen_id;
          const pageId = ch.value?.page_id;
          const { rows } = await pool.query("SELECT id, access_token FROM accounts WHERE platform='meta' AND external_account_id=$1 LIMIT 1", [pageId]);
          if (!rows.length) continue;
          const accId = rows[0].id;
          const pageToken = dec(rows[0].access_token);
          const leadRes = await fetch(`https://graph.facebook.com/v21.0/${leadId}?access_token=${pageToken}`);
          const lead = await leadRes.json();
          const fields = {};
          let fullName=null, phone=null, email=null;
          (lead.field_data || []).forEach(f => {
            fields[f.name] = f.values?.[0];
            if (["full_name","name"].includes(f.name)) fullName = f.values?.[0];
            if (["phone_number","phone"].includes(f.name)) phone = f.values?.[0];
            if (["email"].includes(f.name)) email = f.values?.[0];
          });
          await insertLead({
            platform: "meta",
            external_lead_id: String(lead.id),
            form_id: lead.form_id ? String(lead.form_id) : null,
            campaign_id: ch.value?.adgroup_id || null,
            adset_id: ch.value?.adset_id || null,
            ad_id: ch.value?.ad_id || null,
            full_name: fullName, phone, email,
            fields,
            created_at: new Date(lead.created_time),
            source_account: accId
          });
        }
      }
    }
    res.sendStatus(200);
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

// TikTok OAuth (skeleton)
app.get("/auth/tiktok", (req, res) => {
  const scopes = ["ad.lead:read","user.info.basic"].join(",");
  const url = `https://www.tiktok.com/v2/auth/authorize/?client_key=${TIKTOK_CLIENT_KEY}&response_type=code&scope=${encodeURIComponent(scopes)}&redirect_uri=${encodeURIComponent(TIKTOK_REDIRECT_URI)}&state=xyz`;
  res.redirect(url);
});
app.get("/auth/tiktok/callback", async (req, res) => {
  try {
    const code = req.query.code;
    const tokenRes = await fetch("https://open.tiktokapis.com/v2/oauth/token/", {
      method: "POST",
      headers: { "Content-Type":"application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_key: TIKTOK_CLIENT_KEY,
        client_secret: TIKTOK_CLIENT_SECRET,
        code, grant_type: "authorization_code", redirect_uri: TIKTOK_REDIRECT_URI
      })
    });
    const token = await tokenRes.json();
    await upsertAccount({
      platform: "tiktok",
      external_account_id: "primary",
      name: "TikTok Ads",
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      token_expires_at: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null
    });
    res.send("TikTok connected ✅");
  } catch (e) {
    console.error(e);
    res.status(500).send("TikTok connect error");
  }
});
app.get("/jobs/tiktok-pull", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, access_token FROM accounts WHERE platform='tiktok'");
    for (const r of rows) {
      const token = dec(r.access_token);
      // TODO: call TikTok lead retrieval API and insert via insertLead(...)
    }
    res.send("OK");
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

// Snap OAuth (skeleton)
app.get("/auth/snap", (req, res) => {
  const scopes = ["snapchat-marketing-api","profile"].join(" ");
  const url = `https://accounts.snapchat.com/login/oauth2/authorize?client_id=${SNAP_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(SNAP_REDIRECT_URI)}&scope=${encodeURIComponent(scopes)}`;
  res.redirect(url);
});
app.get("/auth/snap/callback", async (req, res) => {
  try {
    const code = req.query.code;
    const tokenRes = await fetch("https://accounts.snapchat.com/login/oauth2/access_token", {
      method:"POST",
      headers:{ "Content-Type":"application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: SNAP_CLIENT_ID,
        client_secret: SNAP_CLIENT_SECRET,
        code,
        grant_type: "authorization_code",
        redirect_uri: SNAP_REDIRECT_URI
      })
    });
    const token = await tokenRes.json();
    await upsertAccount({
      platform:"snap",
      external_account_id:"primary",
      name:"Snap Ads",
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      token_expires_at: token.expires_in ? new Date(Date.now() + token.expires_in * 1000) : null
    });
    res.send("Snapchat connected ✅");
  } catch (e) {
    console.error(e);
    res.status(500).send("Snap connect error");
  }
});
app.get("/jobs/snap-pull", async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT id, access_token FROM accounts WHERE platform='snap'");
    for (const r of rows) {
      const token = dec(r.access_token);
      // TODO: call Snapchat API to fetch leads and insert via insertLead(...)
    }
    res.send("OK");
  } catch (e) {
    console.error(e);
    res.sendStatus(500);
  }
});

// API for frontend
app.get("/api/leads", async (req, res) => {
  const { platform, q } = req.query;
  const where = [];
  const vals = [];
  if (platform) { vals.push(platform); where.push(`platform = $${vals.length}`); }
  if (q) { vals.push(`%${q}%`); where.push(`(coalesce(full_name,'') ILIKE $${vals.length} OR coalesce(phone,'') ILIKE $${vals.length} OR coalesce(email,'') ILIKE $${vals.length})`); }
  const sql = `SELECT * FROM leads ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT 500`;
  const { rows } = await pool.query(sql, vals);
  res.json(rows);
});

// Export app for Vercel Serverless
export default app;

// Local run
if (!process.env.VERCEL) {
  app.listen(PORT, () => console.log(`API running on :${PORT}`));
}
