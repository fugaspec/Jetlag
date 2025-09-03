const nodemailer = require('nodemailer');

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
    const raw = Buffer.concat(chunks).toString('utf8');
    body = raw ? JSON.parse(raw) : {};
  } catch (err) {
    console.error('[dispatch] Failed to parse JSON body', err);
    body = {}; // ← fallback
  }
}

    const email = body && body.email;
    const country = body && body.country;
    if (!email || !/^\S+@\S+\.\S+$/.test(email) || !country) {
      res.status(400).json({ error: 'Invalid request' });
      return;
    }

    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_PASS;
    if (!user || !pass) {
      res.status(500).json({ error: 'Missing Gmail credentials' });
      return;
    }

    const transporter = nodemailer.createTransport({ service: 'gmail', auth: { user, pass } });
    await transporter.verify();

    const subject = `We've arrived. — ${country}`;
    const textBody = [
      `We have just landed in ${country}`,
      '',
      `"Souls can't move that quickly, and are left behind, and must be awaited, upon arrival, like lost luggage.",',
      '',
      '- The perfect jet lag',
      '',
      'Cooperated with Genelec Japan'
    ].join('\n');

    const info = await transporter.sendMail({
      from: user,
      to: email,
      subject,
      text: textBody
    });

    let queuedToGAS = false;

    res.status(200).json({ ok: true, messageId: info.messageId });
  } catch (e) {
    console.error('[dispatch] MAIL_ERROR', e);
    res.status(500).json({ error: e.message || 'Server Error' });
  }
};
