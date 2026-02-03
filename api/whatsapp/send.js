export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"Method not allowed" });
  }

  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ ok:false, error:"Phone required" });

    const message = `أهلاً وسهلاً بك 👋
معك فريق محمد بن دخار العجمي للسيارات 🚗
يسعدنا خدمتك ومساعدتك في اختيار سيارتك المناسبة ✨`;

    const BASE = process.env.MERSAL_BASE_URL;
    const TOKEN = process.env.MERSAL_TOKEN;

    const response = await fetch(`${BASE}/api/send-message`, {  // ← المسار غالبًا كده (لو اختلف نعدله)
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${TOKEN}`
      },
      body: JSON.stringify({
        phone: phone,
        message: message
      })
    });

    const data = await response.json().catch(()=>({}));

    if (!response.ok) {
      return res.status(500).json({ ok:false, error:"Mersal error", details:data });
    }

    return res.status(200).json({ ok:true });

  } catch (err) {
    console.error(err);
    return res.status(500).json({ ok:false, error:"Server error" });
  }
}
