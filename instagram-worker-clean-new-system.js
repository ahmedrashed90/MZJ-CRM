export default {
  async fetch(request, env) {
    const corsHeaders = {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type,authorization",
    };

    try {
      const url = new URL(request.url);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }

      if (request.method === "GET" && url.pathname === "/") {
        return json({
          ok: true,
          service: "instagram-clean-new-system",
          routes: {
            health: "GET /",
            send: "POST /send",
            crm_send: "POST /crm/send",
            manychat: "POST /webhook/manychat"
          },
          env: {
            manychat: !!(env.MANYCHAT_API_TOKEN || env.MANYCHAT_API_KEY),
            project: !!env.FIREBASE_PROJECT_ID,
            service: !!env.SERVICE_ACCOUNT_JSON
          }
        }, 200, corsHeaders);
      }

      if (request.method === "POST" && (url.pathname === "/send" || url.pathname === "/crm/send")) {
        return await handleSend(request, env, corsHeaders);
      }

      if (request.method === "POST" && url.pathname === "/webhook/manychat") {
        return await handleWebhook(request, env, corsHeaders);
      }

      return json({ ok: false, error: "Not found" }, 404, corsHeaders);
    } catch (err) {
      return json({
        ok: false,
        error: err?.message || String(err),
        stack: err?.stack || ""
      }, 500, corsHeaders);
    }
  }
};

/* =========================
   SEND FROM CRM
========================= */

async function handleSend(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);

  const conversationId = String(body.convId || body.conversationId || "").trim();
  let subscriberId = String(body.subscriber_id || body.subscriberId || body.participantId || "").trim();

  if (!subscriberId && conversationId) {
    const parts = conversationId.split(":");
    subscriberId = parts[parts.length - 1] || "";
  }

  const message = String(body.message || body.text || "").trim();
  const displayName = String(body.displayName || body.name || "Instagram User").trim();

  if (!subscriberId) return json({ ok: false, error: "subscriber_id/participantId is required" }, 400, corsHeaders);
  if (!message) return json({ ok: false, error: "message is required" }, 400, corsHeaders);

  const token = env.MANYCHAT_API_TOKEN || env.MANYCHAT_API_KEY;
  if (!token) return json({ ok: false, error: "Missing MANYCHAT_API_TOKEN or MANYCHAT_API_KEY in env" }, 500, corsHeaders);

  const sendRes = await sendInstagramManyChatText(subscriberId, message, token);
  if (!sendRes.ok) {
    return json({ ok: false, error: "ManyChat send failed", details: sendRes.details }, 502, corsHeaders);
  }

  const now = nowISO();
  const pageId = cleanPageId(String(body.pageId || body.page_id || env.INBOX_PAGE_ID || "").trim());
  const convId = conversationId || buildConversationId(pageId, subscriberId);

  const existing = await getConversation(env, convId).catch(() => null);
  const serviceKey = normalizeServiceKey(existing?.serviceKey || existing?.autoService || "cs");

  await setConversationClean(env, convId, {
    conversationId: convId,
    convId,
    contactKey: convId,
    channel: "instagram",
    channelCode: "ig",
    provider: "meta",
    pageId,
    participantId: subscriberId,
    igId: subscriberId,
    displayName: existing?.displayName || displayName,
    lastMessageAt: now,
    lastMessageText: message,
    updatedAt: now,
    unreadCount: Number(existing?.unreadCount || 0),
    status: existing?.status || "open",
    serviceKey,
    autoService: serviceKey,
    department: getDepartmentCodeByService(serviceKey),
    sectionLabel: getSectionLabelByService(serviceKey),
    branchId: existing?.branchId || "",
    branch: existing?.branch || "",
    branchName: existing?.branchName || ""
  });

  const messageId = `ig_out_${Date.now()}`;
  await setMessage(env, convId, messageId, {
    id: messageId,
    conversationId: convId,
    convId,
    direction: "out",
    text: message,
    type: "text",
    senderName: "CRM",
    senderId: "crm",
    participantId: subscriberId,
    channel: "instagram",
    channelCode: "ig",
    provider: "meta",
    createdAt: now,
    updatedAt: now,
    sentAt: now,
    status: "sent"
  });

  return json({
    ok: true,
    mode: "sendContent",
    conversationId: convId,
    details: sendRes.raw || null
  }, 200, corsHeaders);
}

async function sendInstagramManyChatText(subscriberId, text, manychatToken) {
  const payload = {
    subscriber_id: Number(subscriberId),
    data: {
      version: "v2",
      content: {
        type: "instagram",
        messages: [{ type: "text", text: String(text) }]
      }
    }
  };

  const r = await fetch("https://api.manychat.com/fb/sending/sendContent", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${manychatToken}`,
      "Content-Type": "application/json",
      Accept: "application/json"
    },
    body: JSON.stringify(payload)
  });

  const rawTxt = await r.text();
  let raw = rawTxt;
  try { raw = JSON.parse(rawTxt); } catch {}

  if (!r.ok) return { ok: false, details: raw };
  return { ok: true, raw, message_id: raw?.data?.message_id || raw?.message_id || null };
}

/* =========================
   RECEIVE FROM MANYCHAT
========================= */

async function handleWebhook(request, env, corsHeaders) {
  const body = await request.json().catch(() => null);
  if (!body) return json({ ok: false, error: "Invalid JSON body" }, 400, corsHeaders);

  const now = nowISO();

  const participantId = String(
    body.participantId ??
    body.participant_id ??
    body.subscriber_id ??
    body.subscriberId ??
    body.contact_id ??
    body.contactId ??
    ""
  ).trim();

  if (!participantId) {
    return json({ ok: false, error: "participantId/subscriber_id is required" }, 400, corsHeaders);
  }

  const pageId = cleanPageId(String(body.pageId ?? body.page_id ?? env.INBOX_PAGE_ID ?? "").trim());
  const conversationId = String(body.conversationId || body.conversation_id || buildConversationId(pageId, participantId)).trim();
  const contactKey = conversationId;

  const serviceKey = normalizeServiceKey(body.serviceKey || body.service_key || "cs");
  const sectionLabel = getSectionLabelByService(serviceKey);
  const department = getDepartmentCodeByService(serviceKey);
  const actualBranch = getActualBranchFromBody(body);
  const status = String(body.status || "open").trim() || "open";

  const displayName = String(
    body.displayName ??
    body.name ??
    body.full_name ??
    "Instagram User"
  ).trim();

  const messageText = String(
    body.message ??
    body.text ??
    body.previewText ??
    body.lastMessageText ??
    categoryPreview(serviceKey)
  ).trim();

  const existing = await getConversation(env, conversationId).catch(() => null);
  const unreadCount = Number(existing?.unreadCount || 0) + (messageText ? 1 : 0);

  await setConversationClean(env, conversationId, {
    conversationId,
    convId: conversationId,
    contactKey,
    channel: "instagram",
    channelCode: "ig",
    provider: "meta",
    pageId,
    participantId,
    igId: participantId,
    displayName,
    lastMessageAt: now,
    lastMessageText: messageText,
    updatedAt: now,
    unreadCount,
    status,
    serviceKey,
    autoService: serviceKey,
    department,
    sectionLabel,
    branchId: actualBranch,
    branch: actualBranch,
    branchName: actualBranch
  });

  const saveMessage = body.saveMessage === undefined ? true : toBool(body.saveMessage);
  if (saveMessage && messageText) {
    const msgDedup = safeDocId(`${conversationId}_${serviceKey}_${messageText}`.slice(0, 180));
    const messageId = String(body.messageId || body.message_id || `ig_manychat_${msgDedup}`);

    await setMessage(env, conversationId, messageId, {
      id: messageId,
      conversationId,
      convId: conversationId,
      direction: "in",
      text: messageText,
      type: "text",
      senderName: displayName,
      senderId: participantId,
      participantId,
      channel: "instagram",
      channelCode: "ig",
      provider: "meta",
      createdAt: now,
      updatedAt: now,
      receivedAt: now,
      status: "received"
    });
  }

  let leadResult = null;
  const createLead = toBool(body.createLead) || ["cash", "finance", "cs"].includes(serviceKey);

  if (createLead) {
    leadResult = await upsertLeadFromAutomation({
      env,
      body,
      now,
      conversationId,
      participantId,
      pageId,
      displayName,
      serviceKey,
      actualBranch
    });
  }

  return json({
    ok: true,
    mode: "webhook",
    conversationId,
    unreadCount,
    lead: leadResult
  }, 200, corsHeaders);
}

/* =========================
   LEADS
========================= */

async function upsertLeadFromAutomation({
  env,
  body,
  now,
  conversationId,
  participantId,
  pageId,
  displayName,
  serviceKey,
  actualBranch
}) {
  const leadServiceKey = normalizeServiceKey(body.leadServiceKey || body.lead_service_key || serviceKey || "cs");
  const keepFinanceData = leadServiceKey === "finance";

  const leadName = String(
    (keepFinanceData
      ? (body.leadName || body.name || body.full_name)
      : (body.displayName || body.leadName || body.name || body.full_name)) || ""
  ).trim() || displayName;

  const leadCar = keepFinanceData
    ? String(body.leadCar || body.car || body.carName || body.carModel || body.vehicle || body.vehicleName || "").trim()
    : "";

  const leadPhone = keepFinanceData
    ? String(body.leadPhone || body.phone || body.mobile || body.phoneNumber || "").trim()
    : "";

  const payment = String(body.leadPayment || body.payment || getPayTypeByService(leadServiceKey)).trim();
  const source = String(body.leadSource || body.source || "instagram").trim() || "instagram";
  const platform = String(body.leadPlatform || body.platform || "instagram").trim() || "instagram";
  const status = String(body.leadStatus || body.statusLabel || "عميل جديد").trim() || "عميل جديد";

  // One lead per Instagram subscriber/conversation. The latest choice wins.
  const leadId = String(body.leadId || `lead_ig_${safeDocId(participantId || conversationId)}`).trim();

  const leadData = {
    leadId,
    customerName: leadName,
    fullName: leadName,
    name: leadName,
    displayName: leadName,

    phone: leadPhone,
    mobile: leadPhone,
    phoneNumber: leadPhone,

    car: leadCar,
    carName: leadCar,
    carModel: leadCar,
    vehicleName: leadCar,
    financeCar: keepFinanceData ? leadCar : "",
    financePhone: keepFinanceData ? leadPhone : "",
    clearedFinanceData: !keepFinanceData,

    source,
    sourceName: source,
    platform,
    channel: "instagram",
    channelCode: "ig",
    provider: "meta",

    payment,
    paymentType: payment,
    payType: payment,
    leadPayment: payment,

    serviceKey: leadServiceKey,
    autoService: leadServiceKey,
    latestChoice: leadServiceKey,
    latestChoiceAt: now,

    department: getDepartmentCodeByService(leadServiceKey),
    sectionLabel: getSectionLabelByService(leadServiceKey),

    // Branch is a real branch only. It is not the department.
    branchId: actualBranch,
    branch: actualBranch,
    branchName: actualBranch,

    status,
    leadStatus: status,
    statusLabel: status,
    currentStatus: status,
    currentStatusLabel: status,
    customerStatus: status,
    customerStatusLabel: status,
    pipelineStatus: status,
    pipelineStatusLabel: status,
    stage: status,
    stageLabel: status,

    location: String(body.leadLocation || body.location || body.city || "").trim(),
    place: String(body.leadLocation || body.location || body.city || "").trim(),
    campaignName: String(body.campaignName || body.campaign || "").trim(),
    campaignDate: String(body.campaignDate || "").trim(),

    conversationId,
    convId: conversationId,
    participantId,
    igId: participantId,
    pageId,

    // No automatic assignment in the new system.
    assignedBy: "manychat_automation",
    assignedTo: "",
    assignedName: "",
    salesAssignedTo: "",
    salesAssignedName: "",
    responsible: "",
    responsibleUid: "",
    responsibleName: "",
    callCenter: "",
    callCenterUid: "",
    callCenterName: "",
    callCenterAssignedTo: "",
    callCenterAssignedName: "",
    callCenterAssignedAt: "",

    lastMessageText: String(body.message || body.previewText || categoryPreview(leadServiceKey) || "").replace(/\n+/g, " ").trim(),
    lastTextInput: String(body.message || body.previewText || categoryPreview(leadServiceKey) || "").replace(/\n+/g, " ").trim(),
    inCustomersBase: true,
    createdAt: now,
    updatedAt: now,
    lastUpdated: now
  };

  await firestorePatchDoc(env, `leads/${encodeURIComponent(leadId)}`, leadData);

  return {
    ok: true,
    leadId,
    department: leadData.department,
    payment
  };
}

/* =========================
   FIRESTORE HELPERS
========================= */

async function getConversation(env, conversationId) {
  const doc = await firestoreGetDoc(env, `wa_conversations/${encodeURIComponent(conversationId)}`);
  return doc ? doc.fields : null;
}

async function setConversationClean(env, conversationId, data) {
  const cleanData = {
    ...data,

    // Clear old assignment/old branch-as-section fields from previous Instagram worker versions.
    assignedAt: "",
    assignedBy: "manychat_automation",
    assignedName: "",
    assignedTo: "",
    salesAssignedName: "",
    salesAssignedTo: "",
    callCenterAssignedAt: "",
    callCenterAssignedName: "",
    callCenterAssignedTo: "",
    autoFlowState: ""
  };

  return await firestorePatchDoc(env, `wa_conversations/${encodeURIComponent(conversationId)}`, cleanData);
}

async function setMessage(env, conversationId, messageId, data) {
  return await firestorePatchDoc(
    env,
    `wa_conversations/${encodeURIComponent(conversationId)}/messages/${encodeURIComponent(messageId)}`,
    data
  );
}

async function firestoreGetDoc(env, path) {
  const token = await getGoogleAccessToken(env);

  const url =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}` +
    `/databases/(default)/documents/${path}`;

  const res = await fetch(url, { method: "GET", headers: { Authorization: `Bearer ${token}` } });

  if (res.status === 404) return null;

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firestore GET failed: ${res.status} ${txt}`);
  }

  const data = await res.json();
  return fromFirestoreDoc(data);
}

async function firestorePatchDoc(env, path, data) {
  const token = await getGoogleAccessToken(env);

  const baseUrl =
    `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(env.FIREBASE_PROJECT_ID)}` +
    `/databases/(default)/documents/${path}`;

  const fields = toFirestoreFields(data);
  const updateMask = Object.keys(data)
    .map(k => `updateMask.fieldPaths=${encodeURIComponent(k)}`)
    .join("&");

  const url = `${baseUrl}?${updateMask}`;

  const res = await fetch(url, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ fields })
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`Firestore PATCH failed: ${res.status} ${txt}`);
  }

  const result = await res.json();
  return fromFirestoreDoc(result);
}

/* =========================
   GOOGLE AUTH
========================= */

let __tokenCache = { accessToken: null, expiresAt: 0 };

async function getGoogleAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);

  if (__tokenCache.accessToken && __tokenCache.expiresAt - 60 > now) {
    return __tokenCache.accessToken;
  }

  if (!env.SERVICE_ACCOUNT_JSON) throw new Error("Missing SERVICE_ACCOUNT_JSON in env");
  if (!env.FIREBASE_PROJECT_ID) throw new Error("Missing FIREBASE_PROJECT_ID in env");

  const sa = JSON.parse(env.SERVICE_ACCOUNT_JSON);
  const jwt = await createServiceAccountJWT(sa);

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body:
      "grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer" +
      `&assertion=${encodeURIComponent(jwt)}`
  });

  const data = await res.json();

  if (!res.ok) throw new Error(`Google token error: ${JSON.stringify(data)}`);

  __tokenCache.accessToken = data.access_token;
  __tokenCache.expiresAt = now + Number(data.expires_in || 3600);
  return __tokenCache.accessToken;
}

async function createServiceAccountJWT(sa) {
  const now = Math.floor(Date.now() / 1000);

  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/datastore",
    aud: "https://oauth2.googleapis.com/token",
    exp: now + 3600,
    iat: now
  };

  const encodedHeader = base64url(JSON.stringify(header));
  const encodedPayload = base64url(JSON.stringify(payload));
  const unsigned = `${encodedHeader}.${encodedPayload}`;
  const key = await importPrivateKey(sa.private_key);

  const signature = await crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    key,
    new TextEncoder().encode(unsigned)
  );

  return `${unsigned}.${base64urlBytes(signature)}`;
}

async function importPrivateKey(pem) {
  const clean = String(pem || "")
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");

  const binary = Uint8Array.from(atob(clean), c => c.charCodeAt(0));

  return crypto.subtle.importKey(
    "pkcs8",
    binary.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/* =========================
   HELPERS
========================= */

function buildConversationId(pageId, participantId) {
  return pageId ? `instagram:${pageId}:${participantId}` : `instagram:${participantId}`;
}

function cleanPageId(v) {
  // Keep the value exactly as ManyChat sends it, but trim accidental spaces.
  return String(v || "").trim();
}

function normalizeServiceKey(v) {
  const s = String(v || "").trim().toLowerCase();
  if (["cash", "كاش", "مبيعات الكاش"].includes(s)) return "cash";
  if (["finance", "تمويل", "مبيعات التمويل"].includes(s)) return "finance";
  if (["cs", "customer_service", "خدمة العملاء", "خدمه العملاء"].includes(s)) return "cs";
  return s || "cs";
}

function getDepartmentCodeByService(serviceKey) {
  const key = normalizeServiceKey(serviceKey);
  if (key === "finance") return "finance_sales";
  if (key === "cash") return "cash_sales";
  if (key === "cs") return "customer_service";
  return "customer_service";
}

function getSectionLabelByService(serviceKey) {
  const key = normalizeServiceKey(serviceKey);
  if (key === "finance") return "مبيعات التمويل";
  if (key === "cash") return "مبيعات الكاش";
  if (key === "cs") return "خدمة العملاء";
  return "خدمة العملاء";
}

function getPayTypeByService(serviceKey) {
  const key = normalizeServiceKey(serviceKey);
  if (key === "finance") return "تمويل";
  if (key === "cash") return "كاش";
  if (key === "cs") return "خدمة عملاء";
  return "";
}

function getActualBranchFromBody(body) {
  // لا نستخدم branchId كقسم. الفرع الحقيقي فقط لو اتبعت باسم واضح.
  return String(
    body.actualBranchId ||
    body.realBranchId ||
    body.leadActualBranchId ||
    body.leadBranchActual ||
    body.actualBranch ||
    body.realBranch ||
    ""
  ).trim();
}

function categoryPreview(serviceKey) {
  const key = normalizeServiceKey(serviceKey);
  if (key === "cash") return "🔥 طلب مبيعات كاش";
  if (key === "finance") return "🏦 طلب مبيعات تمويل";
  if (key === "cs") return "🛠 طلب خدمة عملاء";
  return "";
}

function toBool(v) {
  if (typeof v === "boolean") return v;
  return ["1", "true", "yes", "on"].includes(String(v ?? "").trim().toLowerCase());
}

function safeDocId(v) {
  return String(v ?? "")
    .replace(/[\/?#\[\]]/g, "_")
    .replace(/\s+/g, "_")
    .slice(0, 140);
}

function nowISO() {
  return new Date().toISOString();
}

/* =========================
   SERIALIZE HELPERS
========================= */

function toFirestoreFields(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    out[k] = toFirestoreValue(v);
  }
  return out;
}

function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFirestoreValue) } };
  if (typeof v === "object") {
    const fields = {};
    for (const [k, val] of Object.entries(v)) fields[k] = toFirestoreValue(val);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function fromFirestoreDoc(doc) {
  return { name: doc.name, fields: fromFirestoreFields(doc.fields || {}) };
}

function fromFirestoreFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) out[k] = fromFirestoreValue(v);
  return out;
}

function fromFirestoreValue(v) {
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return Number(v.doubleValue);
  if ("booleanValue" in v) return v.booleanValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values || []).map(fromFirestoreValue);
  if ("mapValue" in v) return fromFirestoreFields(v.mapValue.fields || {});
  if ("timestampValue" in v) return v.timestampValue;
  return null;
}

function base64url(input) {
  const bytes = new TextEncoder().encode(input);
  return base64urlBytes(bytes);
}

function base64urlBytes(bytes) {
  let bin = "";
  const arr = bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes;
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...extraHeaders }
  });
}
