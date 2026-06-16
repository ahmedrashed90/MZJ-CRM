import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, doc, getDocs, setDoc, writeBatch, query, limit, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCd2paKL200XRdz2SwFEUzAtfg51xWL5QA",
  authDomain: "mzj-lead.firebaseapp.com",
  projectId: "mzj-lead",
  storageBucket: "mzj-lead.firebasestorage.app",
  messagingSenderId: "470098288857",
  appId: "1:470098288857:web:613125cfc1623b08abdec8",
  measurementId: "G-981Z1T6Z91"
};

const app = getApps()[0] || initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

const state = {
  mounted:false,
  active:false,
  loading:false,
  message:"",
  users:[],
  leads:[],
  convs:[],
  rows:[],
  selected:new Set(),
  targetRepByKey:new Map(),
  lastScanAt:null
};

function esc(v){ return String(v ?? "").replace(/[&<>'"]/g, ch => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[ch])); }
function norm(v){ return String(v ?? "").trim(); }
function digits(v){
  let s = norm(v).replace(/[^0-9+]/g, "").replace(/^00/, "").replace(/^\+/, "");
  if(s.startsWith("05") && s.length === 10) return "966" + s.slice(1);
  if(s.startsWith("5") && s.length === 9) return "966" + s;
  if(s.startsWith("966") && s.length >= 12) return s.slice(0, 12);
  return s.replace(/[^0-9]/g, "");
}
function idOf(d){ return norm(d.id || d.docId || d.documentId || d.__firestoreId || d.leadId || d.conversationId || d.convId); }
function phoneOf(d){ return digits(d.phoneNormalized || d.waId || d.phone || d.mobile || d.phoneNumber || d.customerPhone || d.requestedPhoneNormalized || d.requestedPhone || ""); }
function keyOf(d){ return phoneOf(d) || norm(d.waId || d.conversationId || d.convId || d.leadId || d.id || ""); }
function nameOf(d){ return norm(d.customerName || d.fullName || d.name || d.displayName || d.leadName || "عميل بدون اسم"); }
function repUidOf(d){ return norm(d.responsibleUid || d.assignedTo || d.salesAssignedTo || d.agentUid || d.userUid || d.ownerUid || d.repUid || d.proposedAssignedTo || ""); }
function repNameOf(d){ return norm(d.responsibleName || d.assignedName || d.salesAssignedName || d.agentName || d.userName || d.ownerName || d.repName || d.proposedAssignedName || ""); }
function branchOf(d){ return norm(d.branchName || d.branch || d.branchLabel || d.currentBranchName || d.transferredToBranchName || ""); }
function depKey(raw){
  const s = norm(raw).toLowerCase();
  if(s.includes("finance") || s.includes("تمويل")) return "finance";
  if(s.includes("service") || s.includes("خدمة")) return "service";
  if(s.includes("call") || s.includes("كول")) return "call_center";
  if(s.includes("cash") || s.includes("كاش")) return "cash";
  return norm(raw) || "";
}
function depOf(d){ return depKey(d.departmentKey || d.department || d.section || d.currentDepartment || d.serviceKey || d.autoService || d.payment || d.leadPayment || ""); }
function depLabel(k){ return k === "finance" ? "مبيعات التمويل" : k === "service" ? "خدمة العملاء" : k === "call_center" ? "كول سنتر" : k === "cash" ? "مبيعات الكاش" : norm(k); }
function paymentFor(k){ return k === "finance" ? "تمويل" : k === "service" ? "خدمة عملاء" : k === "cash" ? "كاش" : k === "call_center" ? "تمويل" : ""; }
function serviceFor(k){ return k === "finance" || k === "call_center" ? "finance" : k === "service" ? "cs" : k === "cash" ? "cash" : ""; }
function userUid(u){ return norm(u.uid || u.id || u.userId || u.localId || ""); }
function userName(u){ return norm(u.name || u.displayName || u.email || userUid(u)); }
function userDep(u){ return depKey(u.departmentKey || u.departmentName || u.department || u.section || ""); }
function userBranch(u){ return norm(u.branchName || u.branch || ""); }
function repLabel(uid, name){ return norm(name) || norm(uid) || "غير محدد"; }
function uniqueById(list){ const m = new Map(); list.forEach(x => { const id = userUid(x); if(id && !m.has(id)) m.set(id,x); }); return Array.from(m.values()); }

function injectStyles(){
  if(document.getElementById("mzj-match-audit-style")) return;
  const style = document.createElement("style");
  style.id = "mzj-match-audit-style";
  style.textContent = `
    .mzj-match-hidden{display:none!important}
    .mzj-match-panel{margin-top:16px;direction:rtl;text-align:right}
    .mzj-match-panel .match-head{display:flex;gap:10px;align-items:center;justify-content:space-between;flex-wrap:wrap;margin-bottom:12px}
    .mzj-match-panel .match-title{font-size:18px;font-weight:800;margin:0}
    .mzj-match-panel .match-sub{color:#64748b;font-size:13px;margin-top:4px}
    .mzj-match-panel .match-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
    .mzj-match-panel .match-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px;margin:12px 0}
    .mzj-match-panel .match-stat{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:12px;box-shadow:0 8px 20px rgba(15,23,42,.04)}
    .mzj-match-panel .match-stat b{display:block;font-size:22px;margin-top:4px;color:#0f172a}
    .mzj-match-panel .match-stat span{font-size:12px;color:#64748b}
    .mzj-match-panel .match-card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:14px;margin:12px 0;box-shadow:0 8px 22px rgba(15,23,42,.05);overflow:auto}
    .mzj-match-panel table{width:100%;border-collapse:collapse;min-width:850px}
    .mzj-match-panel th,.mzj-match-panel td{border-bottom:1px solid #eef2f7;padding:9px 8px;font-size:12px;vertical-align:middle;white-space:nowrap}
    .mzj-match-panel th{background:#f8fafc;color:#334155;font-weight:800;position:sticky;top:0;z-index:1}
    .mzj-match-panel .bad{color:#b91c1c;font-weight:800}.mzj-match-panel .ok{color:#047857;font-weight:800}.mzj-match-panel .muted{color:#64748b}
    .mzj-match-panel select,.mzj-match-panel input{border:1px solid #cbd5e1;border-radius:10px;padding:8px;background:#fff;min-width:150px}
    .mzj-match-panel .btn{border:0;border-radius:11px;padding:9px 13px;font-weight:800;cursor:pointer;background:#e2e8f0;color:#0f172a}
    .mzj-match-panel .btn.primary{background:#0f172a;color:#fff}.mzj-match-panel .btn.danger{background:#b91c1c;color:#fff}.mzj-match-panel .btn:disabled{opacity:.55;cursor:not-allowed}
    .mzj-match-panel .alert{border-radius:12px;padding:10px 12px;background:#eff6ff;color:#1e3a8a;border:1px solid #bfdbfe;margin:10px 0}
    .mzj-match-panel .alert.error{background:#fef2f2;color:#991b1b;border-color:#fecaca}
    .mzj-match-panel .match-scroll{max-height:520px;overflow:auto}
  `;
  document.head.appendChild(style);
}

async function waitUser(timeout=9000){
  if(auth.currentUser || window.__MZJ_CURRENT_USER__) return auth.currentUser || window.__MZJ_CURRENT_USER__;
  return new Promise(resolve => {
    let done = false;
    const finish = u => { if(done) return; done = true; try{unsub&&unsub();}catch{} clearTimeout(timer); resolve(u || auth.currentUser || window.__MZJ_CURRENT_USER__ || null); };
    let unsub = null;
    try{ unsub = onAuthStateChanged(auth, finish); }catch{}
    const timer = setTimeout(() => finish(null), timeout);
  });
}
async function readCollection(path, max=5000){
  const snap = await getDocs(query(collection(db, path), limit(max)));
  return snap.docs.map(d => ({ id:d.id, docId:d.id, documentId:d.id, __firestoreId:d.id, ...d.data() }));
}

async function scan(){
  state.loading = true; state.message = "جاري قراءة leads و wa_conversations..."; renderPanel();
  try{
    await waitUser();
    const [users, leads, convs] = await Promise.all([readCollection("users", 1000), readCollection("leads", 5000), readCollection("wa_conversations", 5000)]);
    state.users = uniqueById(users).filter(u => u.active !== false && u.isActive !== false).sort((a,b)=>userName(a).localeCompare(userName(b),'ar'));
    state.leads = leads;
    state.convs = convs;
    state.rows = buildRows(leads, convs);
    state.selected = new Set(state.rows.filter(r => r.problem !== "مطابق").map(r => r.key));
    state.targetRepByKey = new Map();
    state.rows.forEach(r => {
      const src = r.lead || r.conv || {};
      const uid = repUidOf(src);
      if(uid) state.targetRepByKey.set(r.key, uid);
    });
    state.lastScanAt = new Date();
    state.message = `تم الكشف: leads = ${leads.length} / wa_conversations = ${convs.length}`;
  }catch(err){ state.message = err?.message || "فشل الكشف"; console.error(err); }
  finally{ state.loading = false; renderPanel(); }
}

function buildRows(leads, convs){
  const m = new Map();
  const add = (type, d) => {
    const key = keyOf(d) || `${type}:${idOf(d)}`;
    if(!m.has(key)) m.set(key, { key, lead:null, conv:null });
    const row = m.get(key);
    if(type === "lead") row.lead = row.lead || d; else row.conv = row.conv || d;
  };
  leads.forEach(d => add("lead", d));
  convs.forEach(d => add("conv", d));
  return Array.from(m.values()).map(row => {
    const l = row.lead, c = row.conv;
    let problem = "مطابق";
    if(!l) problem = "ناقص في leads";
    else if(!c) problem = "ناقص في wa_conversations";
    else {
      const diff = [];
      if(repUidOf(l) && repUidOf(c) && repUidOf(l) !== repUidOf(c)) diff.push("المندوب");
      else if(repNameOf(l) && repNameOf(c) && repNameOf(l) !== repNameOf(c)) diff.push("اسم المندوب");
      if(depOf(l) && depOf(c) && depOf(l) !== depOf(c)) diff.push("القسم");
      if(branchOf(l) && branchOf(c) && branchOf(l) !== branchOf(c)) diff.push("الفرع");
      const lp = norm(l.payment || l.leadPayment || l.paymentType || ""), cp = norm(c.payment || c.leadPayment || c.paymentType || "");
      if(lp && cp && lp !== cp) diff.push("الدفع");
      problem = diff.length ? `اختلاف: ${diff.join("، ")}` : "مطابق";
    }
    return { ...row, problem };
  }).sort((a,b)=> (a.problem === "مطابق") - (b.problem === "مطابق") || nameOf(a.lead || a.conv).localeCompare(nameOf(b.lead || b.conv),'ar'));
}
function targetUserFor(row){
  const uid = state.targetRepByKey.get(row.key) || repUidOf(row.lead || row.conv || "");
  return state.users.find(u => userUid(u) === uid) || null;
}
function countBy(list){
  const out = new Map();
  list.forEach(d => {
    const uid = repUidOf(d) || "__none__";
    const name = repLabel(uid, repNameOf(d));
    if(!out.has(uid)) out.set(uid, {uid, name, count:0});
    out.get(uid).count++;
  });
  return out;
}
function previewCounts(){
  const leadMap = countBy(state.leads);
  const convMap = countBy(state.convs);
  const after = new Map(leadMap);
  state.rows.forEach(row => {
    if(!state.selected.has(row.key)) return;
    const u = targetUserFor(row);
    if(!u) return;
    const uid = userUid(u), name = userName(u);
    const oldUid = repUidOf(row.lead || row.conv || {}) || "__none__";
    if(row.lead && after.has(oldUid)) after.get(oldUid).count = Math.max(0, after.get(oldUid).count - 1);
    if(!after.has(uid)) after.set(uid,{uid,name,count:0});
    after.get(uid).count++;
  });
  const ids = new Set([...leadMap.keys(), ...convMap.keys(), ...after.keys(), ...state.users.map(userUid)]);
  return Array.from(ids).filter(Boolean).map(uid => {
    const u = state.users.find(x => userUid(x) === uid);
    return { uid, name: userName(u || {}) || leadMap.get(uid)?.name || convMap.get(uid)?.name || uid, leads: leadMap.get(uid)?.count || 0, convs: convMap.get(uid)?.count || 0, after: after.get(uid)?.count || 0 };
  }).filter(r => r.leads || r.convs || r.after).sort((a,b)=>b.leads-a.leads || a.name.localeCompare(b.name,'ar'));
}
function payloadForUser(u, base={}){
  const uid = userUid(u), name = userName(u), dep = userDep(u) || depOf(base), branch = userBranch(u) || branchOf(base), pay = paymentFor(dep) || norm(base.payment || base.leadPayment || ""), svc = serviceFor(dep) || norm(base.serviceKey || base.autoService || "");
  const payload = {
    responsibleUid:uid, responsibleName:name,
    assignedTo:uid, assignedName:name,
    salesAssignedTo:uid, salesAssignedName:name,
    agentUid:uid, agentName:name,
    updatedAt:serverTimestamp(), lastUpdated:serverTimestamp(), matchedAt:serverTimestamp(), lastUpdateSource:"admin_client_match_audit_v39"
  };
  if(dep) Object.assign(payload,{department:dep,departmentKey:dep,currentDepartment:dep,section:dep,sectionKey:dep,departmentName:depLabel(dep),departmentLabel:depLabel(dep),sectionLabel:depLabel(dep)});
  if(branch) Object.assign(payload,{branchName:branch,branch:branch,branchLabel:branch,branchDisplayName:branch,currentBranchName:branch});
  if(pay) Object.assign(payload,{payment:pay,paymentType:pay,payType:pay,leadPayment:pay});
  if(svc) Object.assign(payload,{serviceKey:svc,leadServiceKey:svc,autoService:svc});
  return payload;
}
async function applyFix(){
  const rows = state.rows.filter(r => state.selected.has(r.key));
  if(!rows.length) return;
  if(!confirm(`سيتم حفظ تطابق ${rows.length} عميل في leads و wa_conversations. متأكد؟`)) return;
  state.loading = true; state.message = "جاري حفظ التطابق..."; renderPanel();
  let done = 0;
  try{
    for(let i=0;i<rows.length;i+=400){
      const batch = writeBatch(db);
      rows.slice(i,i+400).forEach(row => {
        const u = targetUserFor(row);
        if(!u) return;
        const base = row.lead || row.conv || {};
        const payload = payloadForUser(u, base);
        const key = keyOf(base) || row.key;
        const leadId = idOf(row.lead || {}) || key;
        const convId = idOf(row.conv || {}) || phoneOf(base) || norm(base.conversationId || base.convId || key);
        const common = { ...payload, phoneNormalized: phoneOf(base) || phoneOf(row.lead || {}) || phoneOf(row.conv || ""), waId: phoneOf(base) || phoneOf(row.lead || {}) || phoneOf(row.conv || ""), convId, conversationId:convId };
        if(row.lead) batch.set(doc(db,"leads",leadId), common, {merge:true});
        else batch.set(doc(db,"leads",leadId), {...row.conv, ...common, leadId}, {merge:true});
        if(row.conv) batch.set(doc(db,"wa_conversations",convId), common, {merge:true});
        else batch.set(doc(db,"wa_conversations",convId), {...row.lead, ...common, leadId, conversationId:convId}, {merge:true});
        done++;
      });
      await batch.commit();
    }
    state.message = `تم حفظ التطابق لعدد ${done} عميل. جاري إعادة الكشف...`;
    await scan();
  }catch(err){ state.message = err?.message || "فشل حفظ التطابق"; console.error(err); state.loading = false; renderPanel(); }
}

function renderPanel(){
  const host = document.getElementById("mzj-match-audit-panel");
  if(!host) return;
  const mismatch = state.rows.filter(r => r.problem !== "مطابق");
  const selectedCount = state.selected.size;
  const counts = previewCounts();
  host.innerHTML = `
    <section class="mzj-match-panel">
      <div class="match-head">
        <div><h3 class="match-title">كشف عدم تطابق العملاء</h3><div class="match-sub">الكشف من مسار leads ومسار wa_conversations، مع عد فعلي لكل مندوب قبل حفظ التطابق.</div></div>
        <div class="match-actions">
          <button class="btn" id="mzj-match-refresh" ${state.loading?"disabled":""}>تحميل والكشف</button>
          <button class="btn primary" id="mzj-match-save" ${state.loading||!selectedCount?"disabled":""}>حفظ التطابق المحدد (${selectedCount})</button>
        </div>
      </div>
      ${state.message ? `<div class="alert ${state.message.includes('فشل')||state.message.includes('permission')?'error':''}">${esc(state.message)}</div>` : ""}
      <div class="match-grid">
        <div class="match-stat"><span>إجمالي leads</span><b>${state.leads.length}</b></div>
        <div class="match-stat"><span>إجمالي wa_conversations</span><b>${state.convs.length}</b></div>
        <div class="match-stat"><span>عدم التطابق</span><b>${mismatch.length}</b></div>
        <div class="match-stat"><span>المحدد للحفظ</span><b>${selectedCount}</b></div>
      </div>
      <div class="match-card"><h4>العد الفعلي لكل مندوب قبل وبعد التطابق</h4><div class="match-scroll"><table><thead><tr><th>المندوب</th><th>leads</th><th>wa_conversations</th><th>بعد الحفظ</th><th>الفرق الحالي</th></tr></thead><tbody>${counts.map(c=>`<tr><td>${esc(c.name)}</td><td>${c.leads}</td><td>${c.convs}</td><td><b>${c.after}</b></td><td class="${c.leads===c.convs?'ok':'bad'}">${c.leads-c.convs}</td></tr>`).join("") || `<tr><td colspan="5" class="muted">اضغط تحميل والكشف</td></tr>`}</tbody></table></div></div>
      <div class="match-card"><div class="match-head"><h4>العملاء غير المتطابقين</h4><div class="match-actions"><button class="btn" id="mzj-match-select-all">تحديد الكل</button><button class="btn" id="mzj-match-clear">إلغاء التحديد</button></div></div><div class="match-scroll"><table><thead><tr><th>تحديد</th><th>العميل</th><th>الجوال</th><th>المشكلة</th><th>مندوب leads</th><th>مندوب wa</th><th>المندوب الصحيح للحفظ</th></tr></thead><tbody>${mismatch.map(r=>rowHtml(r)).join("") || `<tr><td colspan="7" class="ok">لا يوجد عدم تطابق حاليًا</td></tr>`}</tbody></table></div></div>
    </section>`;
  bindPanelEvents();
}
function userOptions(selected){
  const unknown = selected && !state.users.some(u => userUid(u) === selected) ? `<option value="${esc(selected)}" selected>${esc(selected)}</option>` : "";
  return unknown + state.users.map(u => `<option value="${esc(userUid(u))}" ${userUid(u)===selected?"selected":""}>${esc(userName(u))} - ${esc(depLabel(userDep(u)))}${userBranch(u)?` - ${esc(userBranch(u))}`:""}</option>`).join("");
}
function rowHtml(r){
  const base = r.lead || r.conv || {};
  const selected = state.targetRepByKey.get(r.key) || repUidOf(base);
  return `<tr data-key="${esc(r.key)}">
    <td><input type="checkbox" class="mzj-match-check" ${state.selected.has(r.key)?"checked":""}></td>
    <td>${esc(nameOf(base))}</td><td>${esc(phoneOf(base) || r.key)}</td><td class="bad">${esc(r.problem)}</td>
    <td>${esc(repLabel(repUidOf(r.lead||{}), repNameOf(r.lead||{})))}</td>
    <td>${esc(repLabel(repUidOf(r.conv||{}), repNameOf(r.conv||{})))}</td>
    <td><select class="mzj-match-rep"><option value="">اختار مندوب</option>${userOptions(selected)}</select></td>
  </tr>`;
}
function bindPanelEvents(){
  const host = document.getElementById("mzj-match-audit-panel"); if(!host) return;
  host.querySelector("#mzj-match-refresh")?.addEventListener("click", scan);
  host.querySelector("#mzj-match-save")?.addEventListener("click", applyFix);
  host.querySelector("#mzj-match-select-all")?.addEventListener("click", () => { state.rows.filter(r=>r.problem!=="مطابق").forEach(r=>state.selected.add(r.key)); renderPanel(); });
  host.querySelector("#mzj-match-clear")?.addEventListener("click", () => { state.selected.clear(); renderPanel(); });
  host.querySelectorAll("tr[data-key]").forEach(tr => {
    const key = tr.getAttribute("data-key");
    tr.querySelector(".mzj-match-check")?.addEventListener("change", e => { e.target.checked ? state.selected.add(key) : state.selected.delete(key); renderPanel(); });
    tr.querySelector(".mzj-match-rep")?.addEventListener("change", e => { state.targetRepByKey.set(key, e.target.value); state.selected.add(key); renderPanel(); });
  });
}

function mountTab(){
  if(String(location.hash||"").replace(/^#\/?/,"") !== "admin") return;
  const tabs = document.querySelector(".admin-tabs");
  if(!tabs) return;
  injectStyles();
  if(!document.getElementById("mzj-match-audit-tab")){
    const btn = document.createElement("button");
    btn.id = "mzj-match-audit-tab";
    btn.type = "button";
    btn.textContent = "كشف تطابق العملاء";
    btn.addEventListener("click", () => activateTab(true));
    tabs.appendChild(btn);
  }
  if(!document.getElementById("mzj-match-audit-panel")){
    const panel = document.createElement("div");
    panel.id = "mzj-match-audit-panel";
    panel.className = "mzj-match-hidden";
    tabs.insertAdjacentElement("afterend", panel);
  }
  if(state.active) activateTab(false);
}
function activateTab(doRender=true){
  state.active = true;
  const tabs = document.querySelector(".admin-tabs");
  const panel = document.getElementById("mzj-match-audit-panel");
  if(!tabs || !panel) return;
  tabs.querySelectorAll("button").forEach(b => b.classList.remove("active"));
  document.getElementById("mzj-match-audit-tab")?.classList.add("active");
  let node = panel.nextElementSibling;
  while(node){ node.classList.add("mzj-match-hidden"); node = node.nextElementSibling; }
  panel.classList.remove("mzj-match-hidden");
  if(doRender) renderPanel();
}
function deactivateIfReactTabClicked(){
  const tabs = document.querySelector(".admin-tabs"); if(!tabs) return;
  tabs.addEventListener("click", e => {
    if(e.target?.id === "mzj-match-audit-tab") return;
    state.active = false;
    const panel = document.getElementById("mzj-match-audit-panel");
    if(panel) panel.classList.add("mzj-match-hidden");
    let node = panel?.nextElementSibling;
    while(node){ node.classList.remove("mzj-match-hidden"); node = node.nextElementSibling; }
  }, { once:false });
}
function boot(){ mountTab(); deactivateIfReactTabClicked(); setInterval(mountTab, 700); window.addEventListener("hashchange", () => setTimeout(mountTab, 350)); }
if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
