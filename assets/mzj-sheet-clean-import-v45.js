import { initializeApp, getApps } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { getFirestore, collection, getDocs, doc, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";

(function(){
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
  const state = { user:null, users:[], parsed:null, rows:[], errors:[], fileName:"", busy:false };

  const hiddenTabs = ["تصحيح المستخدمين والفروع", "كشف تطابق العملاء", "مراجعة أخطاء البيانات", "كشف أخطاء البيانات"];
  const norm = v => String(v ?? "").trim();
  const low = v => norm(v).toLowerCase().replace(/[أإآ]/g,"ا").replace(/ة/g,"ه").replace(/[\s_\-–—]+/g,"");
  const digits = v => norm(v).replace(/[٠-٩]/g, d => "٠١٢٣٤٥٦٧٨٩".indexOf(d)).replace(/[۰-۹]/g, d => "۰۱۲۳۴۵۶۷۸۹".indexOf(d)).replace(/\D+/g, "");
  const todayIso = () => new Date().toISOString();
  const safeId = v => (digits(v) || norm(v).replace(/[^a-zA-Z0-9\u0600-\u06FF]+/g,"-").slice(0,80) || crypto.randomUUID()).slice(0,120);
  const deptKey = v => { const x=low(v); if(x.includes("تمويل")||x.includes("finance")) return "finance_sales"; if(x.includes("خدم")||x.includes("service")) return "customer_service"; if(x.includes("كاش")||x.includes("cash")) return "cash_sales"; return norm(v)||""; };
  const deptLabel = v => { const k=deptKey(v); return k==="finance_sales"?"مبيعات التمويل":k==="customer_service"?"خدمة العملاء":k==="cash_sales"?"مبيعات الكاش":norm(v); };
  const paymentByDept = v => { const k=deptKey(v); return k==="finance_sales"?"تمويل":k==="customer_service"?"خدمة عملاء":k==="cash_sales"?"كاش":norm(v); };
  const statusNorm = v => norm(v) || "عميل جديد";
  const headerIndex = (headers, names) => {
    const m = headers.map(low);
    for (const name of names) { const i = m.indexOf(low(name)); if (i >= 0) return i; }
    for (const name of names) { const n=low(name); const i=m.findIndex(h=>h.includes(n)||n.includes(h)); if (i >= 0) return i; }
    return -1;
  };
  const cell = (row, idx) => idx >= 0 ? norm(row[idx]) : "";
  function findUser(label){
    const raw = norm(label).split(" - ")[0].trim();
    if(!raw) return null;
    const key = low(raw);
    return state.users.find(u => low(u.name) === key || low(u.displayName) === key || low(u.email) === key || low(u.name).includes(key) || key.includes(low(u.name))) || null;
  }
  async function loadUsers(){
    try{
      const snap = await getDocs(collection(db,"users"));
      state.users = snap.docs.map(d => ({ id:d.id, uid:d.id, ...d.data() }));
    }catch(e){
      console.warn("MZJ sheet import: users read failed, fallback to sheet responsible names", e);
      state.users = [];
    }
    return state.users;
  }
  function buildLead(row, idx, headers){
    const ix = {
      name: headerIndex(headers,["اسم العميل","العميل","customer name","name"]),
      phone: headerIndex(headers,["الجوال","الموبايل","رقم الجوال","phone","mobile"]),
      location: headerIndex(headers,["المكان","المدينة","location"]),
      branch: headerIndex(headers,["الفرع","branch"]),
      source: headerIndex(headers,["المصدر","source"]),
      car: headerIndex(headers,["اسم السيارة","السيارة","نوع السيارة","car"]),
      payment: headerIndex(headers,["الدفع","payment"]),
      status: headerIndex(headers,["الحالة","status"]),
      department: headerIndex(headers,["القسم","department"]),
      responsible: headerIndex(headers,["المسؤول","المندوب","responsible","agent"]),
      callcenter: headerIndex(headers,["الكول سنتر","كول سنتر","call center","callcenter"]),
      campaignName: headerIndex(headers,["اسم الحملة","الحملة","campaign name"]),
      campaignDate: headerIndex(headers,["تاريخ الحملة","campaign date"]),
      createdAt: headerIndex(headers,["تاريخ التسجيل","created at","createdAt"]),
      updatedAt: headerIndex(headers,["آخر تحديث","اخر تحديث","updated at","updatedAt"])
    };
    const name = cell(row,ix.name);
    const phone = cell(row,ix.phone);
    const phoneNormalized = digits(phone);
    const departmentName = deptLabel(cell(row,ix.department));
    const departmentKey = deptKey(departmentName);
    const payment = paymentByDept(departmentName || cell(row,ix.payment));
    const branch = cell(row,ix.branch) || (departmentKey==="finance_sales"?"فرع الاونلاين":departmentKey==="customer_service"?"خدمة العملاء":"");
    const responsibleLabel = cell(row,ix.responsible);
    const user = findUser(responsibleLabel);
    const status = statusNorm(cell(row,ix.status));
    const createdRaw = cell(row,ix.createdAt);
    const updatedRaw = cell(row,ix.updatedAt);
    const createdAt = createdRaw || todayIso();
    const updatedAt = updatedRaw || createdAt;
    const responsibleName = user?.name || user?.displayName || responsibleLabel;
    const responsibleUid = user?.uid || user?.id || "";
    const responsibleEmail = user?.email || "";
    const id = safeId(phoneNormalized || phone || name || idx);
    const base = {
      id, customerName:name, name, fullName:name,
      phone, mobile:phone, phoneNumber:phone, phoneNormalized,
      location:cell(row,ix.location), place:cell(row,ix.location),
      branch, branchName:branch, leadBranch:branch,
      source:cell(row,ix.source), leadSource:cell(row,ix.source),
      car:cell(row,ix.car), carName:cell(row,ix.car), vehicleName:cell(row,ix.car),
      payment, leadPayment:payment, paymentType:payment,
      status, currentStatus:status, leadStatus:status, clientStatus:status, customerStatus:status,
      department:departmentName, departmentName, departmentKey, section:departmentName,
      responsible:responsibleName, responsibleName, responsibleUid, responsibleEmail,
      assignedName:responsibleName, assignedToName:responsibleName, assignedTo:responsibleUid, assignedUid:responsibleUid,
      salesName:responsibleName, salesUid:responsibleUid, repName:responsibleName, repUid:responsibleUid,
      callCenter:cell(row,ix.callcenter), callcenter:cell(row,ix.callcenter), callCenterName:cell(row,ix.callcenter),
      campaignName:cell(row,ix.campaignName), campaignDate:cell(row,ix.campaignDate),
      createdAt, registrationDate:createdAt, leadCreatedAt:createdAt,
      updatedAt, lastUpdate:updatedAt, importedFromSheet:true, importSource:"admin_sheet_clean_import_v45"
    };
    const problems = [];
    if(!name) problems.push("اسم العميل فارغ");
    if(!phoneNormalized) problems.push("رقم الجوال غير صحيح");
    if(!departmentKey) problems.push("القسم غير معروف");
    if(!responsibleName) problems.push("المسؤول فارغ");
    if(responsibleLabel && !user) problems.push("المسؤول غير مطابق لمستخدم في السيستم: " + responsibleLabel);
    return { id, name, phone, phoneNormalized, responsibleName, responsibleUid, departmentName, departmentKey, branch, payment, status, lead:base, problems };
  }
  async function loadXlsx(){
    if(window.XLSX) return window.XLSX;
    await new Promise((res,rej)=>{ const s=document.createElement("script"); s.src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"; s.onload=res; s.onerror=()=>rej(new Error("تعذر تحميل قارئ Excel")); document.head.appendChild(s); });
    return window.XLSX;
  }
  async function parseFile(file){
    state.busy=true; state.fileName=file.name; state.parsed=null; state.rows=[]; state.errors=[]; renderPanel();
    try{
      await loadUsers();
      const XLSX = await loadXlsx();
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf,{type:"array", cellDates:false});
      const ws = wb.Sheets[wb.SheetNames[0]];
      const arr = XLSX.utils.sheet_to_json(ws,{header:1,defval:""});
      const headers = (arr[0]||[]).map(norm);
      if(arr.length < 2) throw new Error("الشيت فارغ");
      const seen = new Set();
      const rows = [];
      const errors = [];
      arr.slice(1).forEach((r,i)=>{
        if(!r || r.every(c=>!norm(c))) return;
        const rec = buildLead(r,i+2,headers);
        if(rec.phoneNormalized && seen.has(rec.phoneNormalized)) rec.problems.push("رقم مكرر داخل الشيت");
        if(rec.phoneNormalized) seen.add(rec.phoneNormalized);
        if(rec.problems.length) errors.push({ row:i+2, name:rec.name, phone:rec.phone, problems:rec.problems });
        rows.push(rec);
      });
      state.rows=rows; state.errors=errors; state.parsed={headers};
    }catch(e){ state.errors=[{row:"-",name:"",phone:"",problems:[e.message||String(e)]}]; }
    state.busy=false; renderPanel();
  }
  function counts(){
    const map = new Map();
    for(const r of state.rows){ const key = r.responsibleName || "بدون مسؤول"; const it=map.get(key)||{agent:key,total:0,cash:0,finance:0,service:0}; it.total++; if(r.departmentKey==="cash_sales") it.cash++; else if(r.departmentKey==="finance_sales") it.finance++; else if(r.departmentKey==="customer_service") it.service++; map.set(key,it); }
    return [...map.values()].sort((a,b)=>b.total-a.total);
  }
  async function saveRows(){
    if(!state.rows.length) return;
    if(state.errors.length && !confirm("فيه أخطاء في الشيت. هل تريد الاستيراد رغم الأخطاء؟")) return;
    state.busy=true; renderPanel();
    let ok=0, fail=0, messages=[];
    try{
      for(let i=0;i<state.rows.length;i+=450){
        const batch = writeBatch(db);
        const part = state.rows.slice(i,i+450);
        for(const r of part){
          const data = {...r.lead, importedAt: serverTimestamp(), updatedAt: r.lead.updatedAt || serverTimestamp()};
          batch.set(doc(db,"leads",r.id), data, {merge:false});
        }
        await batch.commit();
        ok += part.length;
      }
      messages.push(`تم استيراد ${ok} عميل بنجاح في leads فقط. المحادثة هتتعمل في wa_conversations وقت ما المندوب يفتح العميل ويبدأ يكلمه.`);
    }catch(e){ fail++; messages.push(`فشل الاستيراد: ${e.message||e}`); }
    state.busy=false; renderPanel(messages.join("\n"));
  }
  function table(rows, cols){
    return `<div class="mzj-sheet-table-wrap"><table><thead><tr>${cols.map(c=>`<th>${c.t}</th>`).join("")}</tr></thead><tbody>${rows.map(r=>`<tr>${cols.map(c=>`<td>${c.v(r)}</td>`).join("")}</tr>`).join("") || `<tr><td colspan="${cols.length}">لا توجد بيانات</td></tr>`}</tbody></table></div>`;
  }
  function renderPanel(message=""){
    const panel = ensurePanel(); if(!panel) return;
    const cs = counts();
    panel.innerHTML = `
      <div class="mzj-sheet-import-head"><div><h2>استيراد العملاء من الشيت</h2><p>بعد تفريغ leads، ارفع شيت العملاء لاستيراد العملاء في قاعدة البيانات والداش بورد فقط. wa_conversations يفضل فاضي ويتعمل تلقائيًا عند بدء المحادثة.</p></div></div>
      <div class="mzj-sheet-cards">
        <div><small>الملف</small><b>${state.fileName||"لم يتم اختيار ملف"}</b></div>
        <div><small>العملاء المقروءة</small><b>${state.rows.length}</b></div>
        <div><small>أخطاء قبل الحفظ</small><b>${state.errors.length}</b></div>
        <div><small>عدد المناديب النهائي</small><b>${cs.length}</b></div>
      </div>
      <div class="mzj-sheet-toolbar">
        <label class="btn primary">${state.busy?"جاري المعالجة...":"اختيار شيت Excel"}<input id="mzjSheetFile" type="file" accept=".xlsx,.xls" ${state.busy?"disabled":""} hidden></label>
        <button id="mzjSaveSheetRows" class="btn primary" ${state.busy||!state.rows.length?"disabled":""}>استيراد العملاء للسيستم</button>
      </div>
      ${message?`<div class="alert" style="white-space:pre-line">${message}</div>`:""}
      ${state.errors.length?`<div class="card"><h3>أخطاء الشيت</h3>${table(state.errors.slice(0,100),[{t:"الصف",v:r=>r.row},{t:"العميل",v:r=>r.name||"-"},{t:"الجوال",v:r=>r.phone||"-"},{t:"المشكلة",v:r=>r.problems.join("، ")}])}</div>`:""}
      <div class="card"><h3>الإجمالي النهائي لكل مندوب بعد الاستيراد</h3>${table(cs,[{t:"المندوب",v:r=>r.agent},{t:"الإجمالي",v:r=>r.total},{t:"كاش",v:r=>r.cash},{t:"تمويل",v:r=>r.finance},{t:"خدمة عملاء",v:r=>r.service}])}</div>
      <div class="card"><h3>معاينة العملاء</h3>${table(state.rows.slice(0,120),[{t:"العميل",v:r=>r.name},{t:"الجوال",v:r=>r.phone},{t:"القسم",v:r=>r.departmentName},{t:"الدفع",v:r=>r.payment},{t:"الفرع",v:r=>r.branch},{t:"المسؤول",v:r=>r.responsibleName},{t:"الحالة",v:r=>r.status}])}</div>
    `;
    panel.querySelector("#mzjSheetFile")?.addEventListener("change", e => e.target.files?.[0] && parseFile(e.target.files[0]));
    panel.querySelector("#mzjSaveSheetRows")?.addEventListener("click", saveRows);
  }
  function ensurePanel(){
    const admin = findAdmin(); if(!admin) return null;
    hideOldTabs(admin);
    let tabs = admin.querySelector(".admin-tabs") || admin.querySelector("[role='tablist']") || admin.firstElementChild;
    if(!tabs) return null;
    let btn = admin.querySelector("#mzjSheetImportTabBtn");
    if(!btn){
      btn = document.createElement("button"); btn.id="mzjSheetImportTabBtn"; btn.type="button"; btn.textContent="استيراد العملاء من الشيت"; btn.className="btn ghost";
      tabs.appendChild(btn);
      btn.addEventListener("click", ()=>activate(admin));
    }
    let panel = admin.querySelector("#mzjSheetImportPanel");
    if(!panel){ panel=document.createElement("section"); panel.id="mzjSheetImportPanel"; panel.className="mzj-sheet-import-panel card"; panel.hidden=true; admin.appendChild(panel); }
    return panel;
  }
  function activate(admin){
    admin.querySelectorAll(".admin-tabs button, [role='tablist'] button").forEach(b=>b.classList.remove("active"));
    admin.querySelector("#mzjSheetImportTabBtn")?.classList.add("active");
    Array.from(admin.children).forEach(ch=>{ if(!ch.classList?.contains("admin-tabs") && ch.id!=="mzjSheetImportPanel") ch.style.display="none"; });
    const panel=admin.querySelector("#mzjSheetImportPanel"); if(panel){panel.hidden=false; panel.style.display="block"; renderPanel();}
  }
  function findAdmin(){
    return document.querySelector(".admin-page") || Array.from(document.querySelectorAll("section,main,div")).find(el=>el.textContent?.includes("إعدادات") && el.querySelector("button"));
  }
  function hideOldTabs(admin){
    Array.from(admin.querySelectorAll("button,[role='tab']")).forEach(b=>{ const t=b.textContent||""; if(hiddenTabs.some(x=>t.includes(x))) b.style.display="none"; });
  }
  function injectCss(){
    if(document.getElementById("mzj-sheet-import-v45-style")) return;
    const st=document.createElement("style"); st.id="mzj-sheet-import-v45-style"; st.textContent=`
      .mzj-sheet-import-panel{margin-top:14px;direction:rtl}.mzj-sheet-import-head{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #ead4c8;padding-bottom:12px;margin-bottom:14px}.mzj-sheet-import-head h2{margin:0;color:#4d2418}.mzj-sheet-import-head p{margin:6px 0 0;color:#8a6d5f;font-weight:800}.mzj-sheet-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;margin-bottom:14px}.mzj-sheet-cards div{border:1px solid #ead4c8;border-radius:16px;background:#fffaf6;padding:12px}.mzj-sheet-cards small{display:block;color:#8a6d5f;font-weight:900}.mzj-sheet-cards b{display:block;margin-top:5px;font-size:20px;color:#4d2418}.mzj-sheet-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:14px}.mzj-check{display:flex;align-items:center;gap:8px;font-weight:900;color:#4d2418}.mzj-sheet-table-wrap{overflow:auto;border:1px solid #ead4c8;border-radius:16px;margin-top:10px}.mzj-sheet-table-wrap table{width:100%;border-collapse:collapse;min-width:800px}.mzj-sheet-table-wrap th{background:#f6e7dc;color:#4d2418}.mzj-sheet-table-wrap th,.mzj-sheet-table-wrap td{border-bottom:1px solid #ead4c8;padding:9px;text-align:right;font-weight:800}.mzj-sheet-table-wrap tr:nth-child(even) td{background:#fffaf6}`;
    document.head.appendChild(st);
  }
  function boot(){ injectCss(); ensurePanel(); }
  onAuthStateChanged(auth,u=>{ state.user=u||null; });
  const mo = new MutationObserver(()=>boot());
  mo.observe(document.documentElement,{subtree:true,childList:true});
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded",boot); else boot();
})();
