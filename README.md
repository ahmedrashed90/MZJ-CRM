# MZJ CRM V3 - Vite + React + Firebase

## التشغيل المحلي
```bash
npm install
npm run dev
```

## النشر على Vercel
- Framework/Preset: Vite
- Build command: npm run build
- Output directory: dist

## Firebase
تسجيل الدخول يعمل عبر Firebase Auth بالإيميل والباسورد.
مسارات Firestore يتم تعديلها من: الإدارة > إعدادات Firebase والمسارات.
لا يتم حفظ إعدادات السيستم في localStorage. كل الإعدادات تقرأ وتكتب في Firestore.


V47: fixed sheet import tab loader, UID map import, leads-only import.
