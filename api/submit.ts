import type { VercelRequest, VercelResponse } from '@vercel/node';
import { DateTime } from 'luxon';
import nodemailer from 'nodemailer';
import { Redis } from '@upstash/redis';

// --- TEMP DIAG: env presence (booleans only) ---
console.log('[diag] has MAIL_FROM?', !!process.env.MAIL_FROM);
console.log('[diag] has GMAIL_USER?', !!process.env.GMAIL_USER);
console.log('[diag] has GMAIL_PASS?', !!process.env.GMAIL_PASS);
console.log('[diag] has AVIATIONSTACK_KEY?', !!process.env.AVIATIONSTACK_KEY);
console.log('[diag] has KV_REST_API_URL?', !!(process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL));
console.log('[diag] has KV_REST_API_TOKEN?', !!(process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN));

// ---- Upstash Redis (KV) ----
const UPSTASH_URL = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const hasKv = !!UPSTASH_URL && !!UPSTASH_TOKEN && /^https?:\/\//.test(UPSTASH_URL);
const redis = hasKv ? new Redis({ url: UPSTASH_URL, token: UPSTASH_TOKEN }) : null;

// ---- Gmail transporter ----
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

// 到着“現地”のHH:mm → JSTの「次に来る同じHH:mm」をUTCで返す
function jstNextSameHm(arrivalUtcISO: string, destTz?: string | null) {
  const arrUtc = DateTime.fromISO(arrivalUtcISO).toUTC();
  const local = destTz ? arrUtc.setZone(destTz) : arrUtc;
  const hour = local.hour, minute = local.minute;
  const nowJst = DateTime.now().setZone('Asia/Tokyo');
  let jst = nowJst.set({ hour, minute, second: 0, millisecond: 0 });
  if (jst <= nowJst) jst = jst.plus({ days: 1 });
  return jst.toUTC();
}

// —— Aviationstack 呼び出し（HND→西側ハブ）——
const WEST_HUBS = [
  'LHR','LGW','CDG','ORY','FRA','MUC','DUS','BER','AMS','MAD','BCN','FCO','CPH','ARN','OSL','ZRH',
  'JFK','EWR','LGA','LAX','SFO','SEA','PDX','SAN','SJC','OAK','LAS','PHX','DEN','DFW','IAH','ORD','DTW','MSP','YYZ','YVR'
];
const IATA_TZ: Record<string, string> = {
  LHR: 'Europe/London', LGW: 'Europe/London', CDG: 'Europe/Paris', ORY: 'Europe/Paris',
  FRA: 'Europe/Berlin', MUC: 'Europe/Berlin', DUS: 'Europe/Berlin', BER: 'Europe/Berlin',
  AMS: 'Europe/Amsterdam', MAD: 'Europe/Madrid', BCN: 'Europe/Madrid', FCO: 'Europe/Rome',
  CPH: 'Europe/Copenhagen', ARN: 'Europe/Stockholm', OSL: 'Europe/Oslo', ZRH: 'Europe/Zurich',
  JFK: 'America/New_York', EWR: 'America/New_York', LGA: 'America/New_York',
  ORD: 'America/Chicago', DFW: 'America/Chicago', IAH: 'America/Chicago',
  DTW: 'America/Detroit', MSP: 'America/Chicago',
  DEN: 'America/Denver', PHX: 'America/Phoenix', LAS: 'America/Los_Angeles',
  LAX: 'America/Los_Angeles', SFO: 'America/Los_Angeles', SAN: 'America/Los_Angeles',
  SJC: 'America/Los_Angeles', OAK: 'America/Los_Angeles', SEA: 'America/Los_Angeles', PDX: 'America/Los_Angeles',
  YYZ: 'America/Toronto', YVR: 'America/Vancouver'
};
const IATA_COUNTRY: Record<string, string> = {
  LHR: 'United Kingdom', LGW: 'United Kingdom',
  CDG: 'France', ORY: 'France',
  FRA: 'Germany', MUC: 'Germany', DUS: 'Germany', BER: 'Germany',
  AMS: 'Netherlands',
  MAD: 'Spain', BCN: 'Spain',
  FCO: 'Italy',
  CPH: 'Denmark', ARN: 'Sweden', OSL: 'Norway',
  ZRH: 'Switzerland',
  JFK: 'United States', EWR: 'United States', LGA: 'United States',
  ORD: 'United States', DFW: 'United States', IAH: 'United States',
  DTW: 'United States', MSP: 'United States',
  DEN: 'United States', PHX: 'United States', LAS: 'United States',
  LAX: 'United States', SFO: 'United States', SAN: 'United States',
  SJC: 'United States', OAK: 'United States', SEA: 'United States', PDX: 'United States',
  YYZ: 'Canada', YVR: 'Canada'
};

function aviationstackUrl() {
  const todayUtc = DateTime.utc().toFormat('yyyy-LL-dd');
  const params = new URLSearchParams({
    access_key: process.env.AVIATIONSTACK_KEY!,
    dep_iata: 'HND',
    arr_iata: WEST_HUBS.join(','),
    flight_date: todayUtc,
  });
  return `http://api.aviationstack.com/v1/flights?${params.toString()}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const { email } = req.body || {};
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });

    const r = await fetch(aviationstackUrl()).catch(() => null as any);
    const j = await r?.json().catch(() => null) as any;
    const data = Array.isArray(j?.data) ? j.data : [];

    const nowUtc = DateTime.utc();
    const cand = data.map((f: any) => {
      const arrIata = f?.arrival?.iata || null;
      const tz = f?.arrival?.timezone || IATA_TZ[arrIata || ''] || null;
      const iso = f?.arrival?.estimated || f?.arrival?.scheduled || null;
      if (!iso) return null;
      const dt = tz ? DateTime.fromISO(iso, { zone: tz }) : DateTime.fromISO(iso);
      if (!dt.isValid) return null;
      const arrUtc = dt.toUTC();
      return (arrUtc > nowUtc) ? { f, tz, arrUtc } : null;
    }).filter(Boolean) as { f: any, tz: string | null, arrUtc: DateTime }[];

    let route = 'HND → WEST';
    let localHM = '18:00';
    let sendAtUtc = DateTime.now().setZone('Asia/Tokyo').set({ hour: 18, minute: 0, second: 0, millisecond: 0 }).toUTC();

    if (cand.length) {
      cand.sort((a, b) => a.arrUtc.toMillis() - b.arrUtc.toMillis());
      const chosen = cand[0];
      route = `${chosen.f?.departure?.iata || 'HND'} → ${chosen.f?.arrival?.iata || 'DEST'}`;
      localHM = chosen.arrUtc.setZone(chosen.tz || 'UTC').toFormat('HH:mm');
      sendAtUtc = jstNextSameHm(chosen.arrUtc.toISO(), chosen.tz);
    }

    // 派生情報（行き先の国・到着予定のフル書式）
    let destCountry = '—';
    let arrivalLocalStr = '—';
    if (cand.length) {
      const chosen = cand[0];
      const destIata: string | undefined = chosen.f?.arrival?.iata;
      const tz = chosen.tz || 'UTC';
      const localDt = chosen.arrUtc.setZone(tz);
      destCountry = (destIata && IATA_COUNTRY[destIata]) || (tz.includes('/') ? tz.split('/')[0] : '—');
      arrivalLocalStr = localDt.toFormat('yyyy-LL-dd HH:mm');
    }

    // ① 即時メール（割り当て通知）
    const subjectNow = `割り当てられました — ${route}`;
    const bodyNow = [
      'あなたのフライトが割り当てられました。',
      `行き先: ${destCountry} (${route.split('→')[1]?.trim() || '—'})`,
      `到着予定（現地）: ${arrivalLocalStr}（${localHM}頃）`,
      '到着の頃、日本時間の同じ時刻に、もう一通メールが届きます。',
      '',
      '— The Perfect Jet Lag'
    ].join('\n');

    try {
      await transporter.sendMail({
        from: process.env.MAIL_FROM,
        to: email,
        subject: subjectNow,
        text: bodyNow,
      });
    } catch (e: any) {
      console.error('[mail] sendMail error name=', e?.name, ' code=', e?.code, ' message=', e?.message);
      // Return a friendly error so we can see it in the UI status
      return res.status(500).json({ error: `mail_error:${e?.code || e?.name || 'unknown'}` });
    }

    // ② 到着メールのジョブを Redis に保存（分バケット）
    try {
      if (!redis) {
        console.warn('[kv] skip queue: redis disabled (missing or invalid UPSTASH/KV env)');
      } else {
        const key = `queue:${sendAtUtc.toFormat('yyyyLLddHHmm')}`;
        const job = { email, route, arrive_local: localHM, arrive_local_full: arrivalLocalStr, dest_country: destCountry, send_at_utc: sendAtUtc.toISO() };
        await (redis as Redis).rpush(key, JSON.stringify(job));
        await (redis as Redis).expire(key, 60 * 60 * 48);
        console.log('[kv] queued', key);
      }
    } catch (e:any) {
      console.warn('[kv] queue error:', e?.message || e);
    }

    return res.status(200).json({ ok: true, route, arrive_local: localHM, send_at_utc: sendAtUtc.toISO() });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'Server Error' });
  }
}