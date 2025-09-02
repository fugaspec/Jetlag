const nodemailer = require('nodemailer');
const { DateTime } = require('luxon');

module.exports = async (req, res) => {
  try {
    if (req.method !== 'POST') {
      res.status(405).json({ error: 'Method Not Allowed' });
      return;
    }

    const { email } = req.body || {};
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      res.status(400).json({ error: 'Invalid email' });
      return;
    }

    // ダミー値（とりあえず送信が通る最小構成）
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

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: process.env.MAIL_FROM || process.env.GMAIL_USER,
      to: email,
      subject: 'Passenger Ticket — The Perfect Jet Lag',
      text: textBody,
    });

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('[submit] MAIL_ERROR', e);
    res.status(500).json({
      error: e && e.message ? String(e.message) : 'Server Error',
      env: {
        hasUser: !!process.env.GMAIL_USER,
        hasPass: !!process.env.GMAIL_PASS,
        hasFrom: !!process.env.MAIL_FROM,
      },
    });
  }
};