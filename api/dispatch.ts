import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import nodemailer from 'nodemailer';

const supa = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// Gmail (App Password) transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try{
    // claim queued emails atomically (avoid double send)
    const { data: claimed, error: claimErr } = await supa
      .from('submissions')
      .update({ status: 'sending' })
      .eq('status','queued')
      .lte('send_at_utc', new Date().toISOString())
      .select('id,email,route_name,arrive_local')
      .limit(100);
    if (claimErr) throw claimErr;

    if (!claimed?.length) return res.status(200).json({ ok:true, sent:0 });

    let sent = 0;
    for (const row of claimed) {
      const subject = `到着しました — ${row.route_name || 'Arrival'}`;
      const body = [
        'あなたの「時刻」は到着しました。',
        row.arrive_local ? `到着（現地）: ${row.arrive_local}` : '',
        '',
        '— The Perfect Jet Lag'
      ].filter(Boolean).join('\n');

      try {
        await transporter.sendMail({
          from: process.env.MAIL_FROM,
          to: row.email,
          subject,
          text: body,
        });

        await supa
          .from('submissions')
          .update({ status:'sent', sent_at_utc: new Date().toISOString() })
          .eq('id', row.id);
        sent++;
      } catch (e) {
        console.error('send_error', row.id, e);
        await supa.from('submissions').update({ status:'queued' }).eq('id', row.id);
      }
    }
    return res.status(200).json({ ok:true, sent });
  }catch(e:any){
    return res.status(500).json({ error: e?.message || 'Server Error' });
  }
}