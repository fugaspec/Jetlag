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

    let body = req.body;
    if (!body || typeof body !== 'object') {
      try {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {}
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

    // ▼ GAS webhook to schedule 2nd email (arrival notice)
try {
  const webhookUrl = process.env.GAS_WEBHOOK_URL;
  const webhookToken = process.env.GAS_TOKEN;

  if (webhookUrl && webhookToken) {
    await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: webhookToken,
        email,
        country: chosen.country
      })
    });
  } else {
    console.warn('[submit] GAS env missing (GAS_WEBHOOK_URL / GAS_TOKEN)');
  }
} catch (e) {
  console.error('[submit] GAS webhook failed', e);
}

    // 一応、割り当て結果を返しておく（UI側で使いたくなったら便利）
    res.status(200).json({ ok: true, to: { city: chosen.city, country: chosen.country }, messageId: info.messageId });
  } catch (e) {
    console.error('[submit] MAIL_ERROR', e);
    res.status(500).json({ error: e.message || 'Server Error' });
  }
};