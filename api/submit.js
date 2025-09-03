const nodemailer = require('nodemailer');

// 日本より遅いタイムゾーン側の主要行き先（ざっくり飛行時間）
const DESTS = [
  { city: "London", country: "UK", duration: "12h 30m" },
  { city: "Paris", country: "France", duration: "12h 15m" },
  { city: "Berlin", country: "Germany", duration: "13h 00m" },
  { city: "Amsterdam", country: "Netherlands", duration: "12h 20m" },
  { city: "New York", country: "USA", duration: "13h 00m" },
  { city: "Toronto", country: "Canada", duration: "12h 50m" },
  { city: "Los Angeles", country: "USA", duration: "11h 00m" }
];

function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    // ---- Body parse（保険つき）----
    let body = req.body;
    if (!body || typeof body !== 'object') {
      try {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        const raw = Buffer.concat(chunks).toString('utf8');
        body = raw ? JSON.parse(raw) : {};
      } catch (err) {
        console.error('[submit] Failed to parse JSON body', err);
        body = {};
      }
    }

    const email = body && body.email;
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      res.status(400).json({ error: 'Invalid email' });
      return;
    }

    const chosen = pickRandom(DESTS);

    const textBody = [
      'Passenger',
      email,
      '',
      'From',
      'Tokyo',
      '',
      'To',
      `${chosen.city}, ${chosen.country}`,
      '',
      'Boarding time',
      chosen.duration,
      '',
      'Cooperated with Genelec Japan'
    ].join('\n');

    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_PASS;
    if (!user || !pass) {
      res.status(500).json({ error: 'Missing Gmail credentials' });
      return;
    }

    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await transporter.verify();

    const info = await transporter.sendMail({
      from: user,
      to: email,
      subject: 'Boarding Pass — The Perfect Jet Lag',
      text: textBody
    });

    // GAS への予約（2通目の到着通知）
    let queuedToGAS = false;
    try {
      const webhookUrl = process.env.GAS_WEBHOOK_URL;
      const webhookToken = process.env.GAS_TOKEN;

      console.log('[submit] GAS env present?', {
        hasUrl: !!webhookUrl,
        hasToken: !!webhookToken,
      });
      console.log('[submit] chosen', { country: chosen.country });

      if (webhookUrl && webhookToken) {
        const r = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token: webhookToken,
            email,
            country: chosen.country
          })
        });
        const text = await r.text();
        console.log('[submit] GAS response status', r.status);
        console.log('[submit] GAS response snippet', text.slice(0, 120));
        queuedToGAS = r.ok;
      } else {
        console.warn('[submit] GAS env missing (GAS_WEBHOOK_URL / GAS_TOKEN)');
      }
    } catch (e) {
      console.error('[submit] GAS webhook failed', e);
    }

    // 成功レスポンスは1回だけ返す
    res.status(200).json({
      ok: true,
      to: { city: chosen.city, country: chosen.country },
      messageId: info.messageId,
      queuedToGAS
    });
  } catch (e) {
    console.error('[submit] MAIL_ERROR', e);
    res.status(500).json({ error: e.message || 'Server Error' });
  }
};