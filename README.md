# MZJ CRM V3 - v52

- Fix dashboard popup send through the existing Mersal worker without changing the worker.
- WhatsApp/Mersal sources send to https://mersal-crm.next-erp-mzj.workers.dev/send/mersal.
- Outgoing messages appear immediately in the popup chat, then Firestore save is attempted safely.
- Sheet import remains leads-only.
