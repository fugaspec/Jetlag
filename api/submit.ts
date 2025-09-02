const nodemailer = require('nodemailer');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    // リクエストボディの確認
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

    // --- メール本文 ---
    const boardingHM = '18:00';
    const textBody = [
      'Passenger',
      email,
      '',
      'From',
      'Japan',
      '',
      'To',
      '—',
      '',
      'Boarding time',
      boardingHM,
      '',
      'Cooperated with Genelec Japan'
    ].join('\n');

    // --- Gmail 送信設定 ---
    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_PASS;
    const from = process.env.MAIL_FROM || user;

    if (!user || !pass) {
      res.status(500).json({
        error: 'Missing Gmail credentials',
        env: { hasUser: !!user, hasPass: !!pass, hasFrom: !!from }
      });
      return;
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass },
    });

    await transporter.sendMail({
      from,
      to: email,
      subject: 'Passenger Ticket — The Perfect Jet Lag',
      text: textBody,
    });

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[submit] MAIL_ERROR', e);
    res.status(500).json({
      error: e && e.message ? String(e.message) : 'Server Error',
    });
  }
};