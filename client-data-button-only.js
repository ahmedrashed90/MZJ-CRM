/**
 * MZJ-CRM — Client Data Button Only
 * الهدف: يجعل "اسم العميل" في صندوق الوارد يفتح مودال بيانات العميل (بدون لمس باقي الجافاسكربت).
 *
 * يعتمد على وجود الدالة window.__mzjOpenClientData التي تم تعريفها داخل ملف الـ HTML.
 */
(function(){
  function notify(msg){
    try{
      // لو عندكم toast موجودة في النظام
      if(typeof window.toast === "function") return window.toast(msg, "warn");
    }catch(_){}
    alert(msg);
  }

  function openClientData(){
    if(typeof window.__mzjOpenClientData !== "function"){
      notify("زر بيانات العميل: الدالة غير موجودة (window.__mzjOpenClientData). تأكد إن ملف الـ HTML هو النسخة الصحيحة.");
      return;
    }
    window.__mzjOpenClientData();
  }

  function onReady(fn){
    if(document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  onReady(function(){
    // 1) Header name (داخل الشات)
    const chatName = document.getElementById("chatName");
    if(chatName){
      chatName.setAttribute("role","button");
      chatName.setAttribute("tabindex","0");
      chatName.title = "فتح بيانات العميل";
      chatName.addEventListener("click", function(e){
        e.preventDefault();
        e.stopPropagation();
        openClientData();
      });
      chatName.addEventListener("keydown", function(e){
        if(e.key === "Enter" || e.key === " "){
          e.preventDefault();
          openClientData();
        }
      });
    }

    // 2) Name inside conversation list (قائمة المحادثات) — فقط الاسم
    const list = document.getElementById("convList");
    if(list){
      list.addEventListener("click", function(e){
        const nameEl = e.target && e.target.closest && e.target.closest(".convText > b");
        if(!nameEl) return;

        // امنع فتح المحادثة بالضغط العادي
        e.preventDefault();
        e.stopPropagation();

        const convEl = nameEl.closest(".conv");
        if(convEl){
          // افتح المحادثة طبيعيًا (بنفس منطق السيستم) ثم افتح بيانات العميل
          convEl.click();
          // بعد ما تتحدد المحادثة
          setTimeout(openClientData, 60);
        }else{
          openClientData();
        }
      }, true);
    }

    // 3) Debug: لو فيه أخطاء JS تمنع التشغيل
    window.addEventListener("error", function(ev){
      notify("خطأ JavaScript: " + (ev.message || "غير معروف"));
    });
    window.addEventListener("unhandledrejection", function(ev){
      notify("Promise Error: " + (ev.reason && (ev.reason.message || ev.reason) || "غير معروف"));
    });
  });
})();
