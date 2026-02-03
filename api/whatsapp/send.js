export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ ok:false, error:"Method not allowed" });
  }

  try {
    const { phone } = req.body;
    if (!phone) return res.status(400).json({ ok:false, error:"Phone required" });

    // 🔹 رسالة الترحيب الثابتة
    const message = `أهلاً وسهلاً بك 👋
معك فريق محمد بن دخار العجمي للسيارات 🚗
يسعدنا خدمتك ومساعدتك في اختيار سيارتك المناسبة ✨`;

    // 🔹 بيانات مرسال (هتتحط في Environment Variables)
    const MERSAL_URL = process.env.MERSAL_URL;
    const MERSAL_TOKEN = process.env.MERSAL_TOKEN;

    const response = await fetch(MERSAL_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${MERSAL_TOKEN}`
      },
      body: JSON.stringify({
        to: phone,
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
