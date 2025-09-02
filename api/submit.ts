import { DateTime } from 'luxon';
import nodemailer from 'nodemailer';
import { Redis } from '@upstash/redis';

// --- Env / KV ---
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const hasKv = !!UPSTASH_URL && !!UPSTASH_TOKEN && /^https?:\/\//.test(UPSTASH_URL);
const redis = hasKv ? new Redis({ url: UPSTASH_URL, token: UPSTASH_TOKEN }) : null;

// --- Gmail transporter ---
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
});

// 行き先の候補（日本より“西側”（JSTより遅い）を中心に）
const DESTS = [
  { code: 'LHR', country: 'United Kingdom', tz: 'Europe/London' },
  { code: 'CDG', country: 'France', tz: 'Europe/Paris' },
  { code: 'FRA', country: 'Germany', tz: 'Europe/Berlin' },
  { code: 'AMS', country: 'Netherlands', tz: 'Europe/Amsterdam' },
  { code: 'MAD', country: 'Spain', tz: 'Europe/Madrid' },
  { code: 'FCO', country: 'Italy', tz: 'Europe/Rome' },
  { code: 'CPH', country: 'Denmark', tz: 'Europe/Copenhagen' },
  { code: 'ZRH', country: 'Switzerland', tz: 'Europe/Zurich' },
  { code: 'JFK', country: 'United States', tz: 'America/New_York' },
  { code: 'LAX', country: 'United States', tz: 'America/Los_Angeles' },
  { code: 'SFO', country: 'United States', tz: 'America/Los_Angeles' },
  { code: 'SEA', country: 'United States', tz: 'America/Los_Angeles' },
  { code: 'YVR', country: 'Canada', tz: 'America/Vancouver' }
];

function pick<T>(arr: T[]): T { return arr[Math.floor(Math.random()*arr.length)]; }

// Dummy 便生成：送信時刻から 2日以内、ローカル到着時刻 = 10:00/14:00/18:00 のいずれか
function generateDummyFlight() {
  const dest = pick(DESTS);
  const nowJst = DateTime.now().setZone('Asia/Tokyo');
  // 10:00 / 14:00 / 18:00 のいずれか（現地時刻）を選ぶ
  const hmList = [ {h:10,m:0}, {h:14,m:0}, {h:18,m:0} ];
  const { h, m } = pick(hmList);
  // 到着現地日付は今日～+2日のランダム
  const addDays = Math.floor(Math.random()*2); // 0 or 1
  const arriveLocal = DateTime.now().setZone(dest.tz).plus({ days: addDays }).set({ hour: h, minute: m, second:0, millisecond:0 });

  // 二通目は「到着現地と同じ“時刻”をJSTで迎えた時」に送る
  let sendJst = DateTime.now().setZone('Asia/Tokyo').set({ hour: h, minute: m, second:0, millisecond:0 });
  if (sendJst <= nowJst) sendJst = sendJst.plus({ days: 1 });
  const sendAtUtc = sendJst.toUTC();

  const flightNo = `JL${Math.floor(100+Math.random()*900)}`;
  return {
    dest,
    flightNo,
    arriveLocal,
    arriveLocalHM: arriveLocal.toFormat('HH:mm'),
    arriveLocalFull: arriveLocal.toFormat('yyyy-LL-dd HH:mm'),
    sendAtUtc,
    sendAtUtcISO: sendAtUtc.toISO(),
    route: `HND → ${dest.code}`
  };
}

export default async function handler(req: any, res: any) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const { email } = req.body || {};
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return res.status(400).json({ error: 'Invalid email' });
    }

    const f = generateDummyFlight();

    // 1通目メール（Boarding Pass 風）
    const subject1 = `Boarding Pass — ${f.route}`;
    const text1 =
`Passenger\n${email}\n\nFrom\nJapan\n\nTo\n${f.dest.country}\n\nBoarding time\n${f.arriveLocalHM}\n\n- The Perfect Jet Lag\n\nCooperated with Genelec Japan`;

    const html1 = `<!doctype html><html><head><meta charset=\"utf-8\"></head>
  <body style=\"margin:0;padding:24px;background:#f7f7f7;\">
    <div style=\"max-width:560px;margin:0 auto;background:#fff;padding:24px;border:1px solid #eee;\">
      <div style=\"font-family:'OCRB','OCR-B','OCRB Std','OCR A',monospace;letter-spacing:.5px;line-height:1.8;font-size:16px;color:#111;\">
        <div><strong>Passenger</strong><br>${email}</div>
        <div style=\"margin-top:12px\"><strong>From</strong><br>Japan</div>
        <div style=\"margin-top:12px\"><strong>To</strong><br>${f.dest.country}</div>
        <div style=\"margin-top:12px\"><strong>Boarding time</strong><br>${f.arriveLocalHM}</div>
        <div style=\"margin-top:18px\">- The Perfect Jet Lag</div>
        <div style=\"margin-top:16px;font-size:12px;opacity:.7;\">Cooperated with Genelec Japan</div>
      </div>
    </div>
  </body></html>`;

    await transporter.sendMail({ from: process.env.MAIL_FROM, to: email, subject: subject1, text: text1, html: html1 });

    // 2通目（到着通知）をKVに予約
    if (redis) {
      const key = `queue:${f.sendAtUtc.toFormat('yyyyLLddHHmm')}`; // 分単位のキュー
      const job = JSON.stringify({
        email,
        route: f.route,
        dest_country: f.dest.country,
        arrive_local_full: f.arriveLocalFull,
        arrive_local_hm: f.arriveLocalHM,
        send_at_utc: f.sendAtUtcISO,
      });
      await redis.rpush(key, job);
      await redis.expire(key, 60 * 70); // 70分で自動失効
    }

    return res.status(200).json({
      ok: true,
      route: f.route,
      to_country: f.dest.country,
      arrive_local: f.arriveLocalHM,
      send_at_utc: f.sendAtUtcISO,
      note: hasKv ? 'queued' : 'kv disabled',
    });
  } catch (e: any) {
    console.error('[submit] MAIL_ERROR', e);
    return res.status(500).json({
      error: e?.message || 'Server Error',
      stack: e?.stack || null,
      env: {
        hasUser: !!process.env.GMAIL_USER,
        hasPass: !!process.env.GMAIL_PASS,
        hasFrom: !!process.env.MAIL_FROM,
        hasKvUrl: !!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL),
        hasKvToken: !!(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)
      }
    });
  }
}