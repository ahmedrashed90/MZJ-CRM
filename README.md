# MZJ CRM V3 - v52

- Fix dashboard popup send through the existing Mersal worker without changing the worker.
- WhatsApp/Mersal sources send to https://mersal-crm.next-erp-mzj.workers.dev/send/mersal.
- Outgoing messages appear immediately in the popup chat, then Firestore save is attempted safely.
- Sheet import remains leads-only.


V53: Free text send fix. Text typed in dashboard popup is sent as normal Mersal message and does not use template_name unless a real template is selected without text.
