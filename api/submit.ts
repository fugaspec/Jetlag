cd ~/fuga/VSCODE/Jetlag-app/api
cat > submit.js <<'EOF'
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
        body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
      } catch {}
    }

    const email = body && body.email;
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      res.status(400).json({ error: 'Invalid email' });
      return;
    }

    const textBody = [
      'Passenger',
      email,
      '',
      'From',
      'Tokyo',
      '',
      'To',
      '—',
      '',
      'Boarding time',
      '18:00',
      '',
      'Cooperated with Genelec Japan'
    ].join('\n');

    const user = process.env.GMAIL_USER;
    const pass = process.env.GMAIL_PASS;

    if (!user || !pass) {
      res.status(500).json({ error: 'Missing Gmail credentials' });
      return;
    }

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass }
    });
    await transporter.verify();

    const info = await transporter.sendMail({
      from: user,
      to: email,
      subject: 'Passenger Ticket — The Perfect Jet Lag',
      text: textBody
    });

    console.log('[submit] MAIL_SENT', info);
    res.status(200).json({ ok: true, messageId: info.messageId });
  } catch (e) {
    console.error('[submit] MAIL_ERROR', e);
    res.status(500).json({ error: e.message || 'Server Error' });
  }
};
EOF