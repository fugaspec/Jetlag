import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { DateTime } from 'luxon';
import { randomBytes } from 'crypto';

const supa = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const AVIATIONSTACK_KEY = process.env.AVIATIONSTACK_KEY!; 

const WEST_HUBS = [
  'LHR','LGW','CDG','ORY','FRA','MUC','DUS','BER','AMS','MAD','BCN','FCO','CPH','ARN','OSL','ZRH',
  'JFK','EWR','LGA','LAX','SFO','SEA','PDX','SAN','SJC','OAK','LAS','PHX','DEN','DFW','IAH','ORD','DTW','MSP','YYZ','YVR'
];

const IATA_TZ: Record<string,string> = {
  LHR:'Europe/London', LGW:'Europe/London', CDG:'Europe/Paris', ORY:'Europe/Paris',
  FRA:'Europe/Berlin', MUC:'Europe/Berlin', DUS:'Europe/Berlin', BER:'Europe/Berlin',
  AMS:'Europe/Amsterdam', MAD:'Europe/Madrid', BCN:'Europe/Madrid', FCO:'Europe/Rome',
  CPH:'Europe/Copenhagen', ARN:'Europe/Stockholm', OSL:'Europe/Oslo', ZRH:'Europe/Zurich',
  JFK:'America/New_York', EWR:'America/New_York', LGA:'America/New_York',
  ORD:'America/Chicago', DFW:'America/Chicago', IAH:'America/Chicago',
  DTW:'America/Detroit', MSP:'America/Chicago',
  DEN:'America/Denver', PHX:'America/Phoenix', LAS:'America/Los_Angeles',
  LAX:'America/Los_Angeles', SFO:'America/Los_Angeles', SAN:'America/Los_Angeles',
  SJC:'America/Los_Angeles', OAK:'America/Los_Angeles', SEA:'America/Los_Angeles', PDX:'America/Los_Angeles',
  YYZ:'America/Toronto', YVR:'America/Vancouver'
};

function asJstNextSameHm(arrivalUtc: DateTime, destTz?: string | null) {
  const local = destTz ? arrivalUtc.setZone(destTz) : arrivalUtc;
  const hour = local.hour, minute = local.minute;
  const nowJst = DateTime.now().setZone('Asia/Tokyo');
  let jst = nowJst.set({ hour, minute, second:0, millisecond:0 });
  if (jst <= nowJst) jst = jst.plus({ days:1 });
  return jst.setZone('UTC');
}

function aviationstackUrl() {
  const todayUtc = DateTime.utc().toFormat('yyyy-LL-dd');
  const params = new URLSearchParams({
    access_key: AVIATIONSTACK_KEY,
    dep_iata: 'HND',
    arr_iata: WEST_HUBS.join(','),
    flight_date: todayUtc,
  });
  return `http://api.aviationstack.com/v1/flights?${params.toString()}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try{
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });
    const { email } = req.body || {};
    if (!email || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'Invalid email' });

    const r = await fetch(aviationstackUrl()).catch(()=>null as any);
    const json = await r?.json().catch(()=>null) as any;
    const data = Array.isArray(json?.data) ? json.data : [];

    const nowUtc = DateTime.utc();
    const candidates = data.map((f:any) => {
      const arrIata = f?.arrival?.iata || null;
      const tz = f?.arrival?.timezone || IATA_TZ[arrIata || ''] || null;
      const iso = f?.arrival?.estimated || f?.arrival?.scheduled || null;
      if (!iso) return null;
      const dt = tz ? DateTime.fromISO(iso, { zone: tz }) : DateTime.fromISO(iso);
      if (!dt.isValid) return null;
      const arrUtc = dt.toUTC();
      return (arrUtc > nowUtc) ? { f, tz, arrUtc } : null;
    }).filter(Boolean) as { f:any, tz:string|null, arrUtc:DateTime }[];

    let sendAtUtcISO: string;
    let routeName = 'HND → WEST';
    if (candidates.length) {
      candidates.sort((a,b)=> a.arrUtc.toMillis() - b.arrUtc.toMillis());
      const chosen = candidates[0];
      sendAtUtcISO = asJstNextSameHm(chosen.arrUtc, chosen.tz).toISO();
      routeName = `${chosen.f?.departure?.iata || 'HND'} → ${chosen.f?.arrival?.iata || 'DEST'}`;
    } else {
      const nowJst = DateTime.now().setZone('Asia/Tokyo');
      let jst = nowJst.set({ hour:18, minute:0, second:0, millisecond:0 });
      if (jst <= nowJst) jst = jst.plus({ days:1 });
      sendAtUtcISO = jst.setZone('UTC').toISO();
    }

    const token = randomBytes(24).toString('base64url');
    const { error: insErr } = await supa.from('submissions').insert({
      email, flight_id: null, send_at_utc: sendAtUtcISO, token, status:'queued'
    });
    if (insErr) throw insErr;

    return res.status(200).json({ ok:true, route: routeName, send_at_utc: sendAtUtcISO });
  }catch(e:any){
    return res.status(500).json({ error: e?.message || 'Server Error' });
  }
}