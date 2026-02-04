// Vercel Serverless Function
// Place this file at: /api/open-chat.js
//
// ENV VARS on Vercel:
// - MERSAL_TOKEN: your Mersal/WPBX token
// - MERSAL_API_ENDPOINT: base API endpoint, example: https://w-mersal.com
//   (the code will call: {MERSAL_API_ENDPOINT}/api/wpbx/getContacts?token=... etc.)

function normPhone(input){
  return String(input || '')
    .trim()
    .replace(/^00/, '+')
    .replace(/[^\d+]/g,'');
}

export default async function handler(req, res){
  if(req.method !== 'POST'){
    return res.status(405).json({ ok:false, error:'Method not allowed' });
  }

  const token = process.env.MERSAL_TOKEN;
  const apiBase = process.env.MERSAL_API_ENDPOINT;

  if(!token || !apiBase){
    return res.status(500).json({ ok:false, error:'Missing env vars: MERSAL_TOKEN or MERSAL_API_ENDPOINT' });
  }

  const phone = normPhone(req.body?.phone);
  if(!phone){
    return res.status(400).json({ ok:false, error:'Missing phone' });
  }

  // WPBX API endpoints from docs:
  // GET  {api_endpoint}/api/wpbx/getContacts?token=...
  // POST {api_endpoint}/api/wpbx/makeContact?token=...
  const getContactsUrl = `${apiBase.replace(/\/$/,'')}/api/wpbx/getContacts?token=${encodeURIComponent(token)}`;
  const makeContactUrl = `${apiBase.replace(/\/$/,'')}/api/wpbx/makeContact?token=${encodeURIComponent(token)}`;

  try{
    // 1) Get contacts (note: if you have many contacts, consider asking Mersal support for a "GetContact by phone" endpoint)
    const r1 = await fetch(getContactsUrl, { method:'GET' });
    const j1 = await r1.json().catch(()=> ({}));

    const contacts = Array.isArray(j1.contacts) ? j1.contacts : [];
    const phoneDigits = phone.replace(/[^\d]/g,'');
    let contact = contacts.find(c=>{
      const p = normPhone(c?.phone || c?.mobile || c?.number || '');
      return p.replace(/[^\d]/g,'') === phoneDigits;
    });

    // 2) If not found, create contact
    if(!contact){
      const r2 = await fetch(makeContactUrl, {
        method:'POST',
        headers:{ 'Content-Type':'application/json' },
        body: JSON.stringify({ phone })
      });
      const j2 = await r2.json().catch(()=> ({}));
      // different APIs return different shapes; try common ones
      contact = j2.contact || j2.data || j2.result || null;
    }

    const contactId = contact?.id || contact?.contact_id || null;
    if(!contactId){
      return res.status(400).json({ ok:false, error:'Could not resolve contact id', raw: contact || null });
    }

    // 3) Open chat page (Mersal web app)
    const url = `https://w-mersal.com/chat?contact_id=${encodeURIComponent(contactId)}`;

    return res.status(200).json({ ok:true, url, contact_id: contactId });
  }catch(err){
    console.error(err);
    return res.status(500).json({ ok:false, error:'Server error' });
  }
}
