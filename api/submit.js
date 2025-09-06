// /api/submit.js
// Node 18 / Vercel Serverless (CommonJS)

const nodemailer = require('nodemailer');

// 表示用の「Boarding time」と、GASに渡す「分(min)」を両方保持
const DESTS = [
  { city: "London",      country: "UK",          durationStr: "12h 30m", durationMin: 12*60 + 30 },
  { city: "Paris",       country: "France",      durationStr: "12h 50m", durationMin: 12*60 + 50 },
  { city: "Berlin",      country: "Germany",     durationStr: "13h 00m", durationMin: 13*60 },
  { city: "Amsterdam",   country: "Netherlands", durationStr: "12h 20m", durationMin: 12*60 + 20 },
  { city: "New York",    country: "USA",         durationStr: "13h 00m", durationMin: 13*60 },
  { city: "Toronto",     country: "Canada",      durationStr: "12h 50m", durationMin: 12*60 + 50 },
  { city: "Los Angeles", country: "USA",         durationStr: "11h 00m", durationMin: 11*60 }
];

function pickRandom(arr){ return arr[Math.floor(Math.random()*arr.length)]; }

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    // --- Body parse（保険付き）---
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

    // --- 目的地をランダム選択 ---
    const chosen = pickRandom(DESTS);

    // --- 1通目の本文（OCR-B想定のプレーンテキスト）---
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
      chosen.durationStr,
      '',
      'Cooperated with Genelec Japan'
    ].join('\n');

    // --- Gmail送信 ---
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

    // --- GASへ到着メールの予約（minutes を渡す！）---
    let queuedToGAS = false;
    try {
      const webhookUrl   = process.env.GAS_WEBHOOK_URL; // 例: https://script.google.com/macros/s/xxxx/exec
      const webhookToken = process.env.GAS_TOKEN;        // 例: jetlag-xyz-2025

      if (webhookUrl && webhookToken) {
        const r = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            token:   webhookToken,
            email:   email,
            country: chosen.country,
            minutes: chosen.durationMin   // ← これが “Boarding time と同じ分数”
          })
        });
        const text = await r.text();
        console.log('[submit] GAS status', r.status, '| resp:', text.slice(0,120));
        queuedToGAS = r.ok;
      } else {
        console.warn('[submit] GAS env missing (GAS_WEBHOOK_URL / GAS_TOKEN)');
      }
    } catch (e) {
      console.error('[submit] GAS webhook failed', e);
    }

    // --- レスポンス ---
    res.status(200).json({
      ok: true,
      to: { city: chosen.city, country: chosen.country, boardingTime: chosen.durationStr },
      messageId: info.messageId,
      queuedToGAS
    });
  } catch (e) {
    console.error('[submit] MAIL_ERROR', e);
    res.status(500).json({ error: e.message || 'Server Error' });
  }
};