import { NextResponse } from 'next/server';
import nodemailer from 'nodemailer';

export async function POST(req) {
  try {
    const { supplierName, phone, agentName, scheduledTime } = await req.json();

    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    const agentEmails = {
      'ינון': process.env.EMAIL_YINON || process.env.EMAIL_TO,
      'הודיה': process.env.EMAIL_HODAYA || process.env.EMAIL_TO,
      'טל': process.env.EMAIL_TAL || process.env.EMAIL_TO,
    };
    const toEmail = agentEmails[agentName] || process.env.EMAIL_TO;

    await transporter.sendMail({
      from: `"Fiesta CRM" <${process.env.EMAIL_USER}>`,
      to: toEmail,
      subject: `⏰ תזכורת - לחזור לספק: ${supplierName}`,
      html: `
        <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 500px; margin: 0 auto; background: #f8fafc; padding: 30px; border-radius: 16px;">
          <h1 style="color: #8b5cf6; font-size: 1.8rem; margin-bottom: 8px;">⏰ תזכורת Fiesta</h1>
          <p style="color: #64748b; margin-bottom: 24px;">הגיע הזמן לחזור לספק!</p>
          <div style="background: white; border-radius: 12px; padding: 20px; border: 1px solid #e2e8f0; margin-bottom: 20px;">
            <p style="margin: 0 0 10px;"><strong>ספק:</strong> ${supplierName}</p>
            <p style="margin: 0 0 10px;"><strong>טלפון:</strong> ${phone}</p>
            <p style="margin: 0 0 10px;"><strong>סוכן:</strong> ${agentName}</p>
            <p style="margin: 0;"><strong>זמן שנקבע:</strong> ${scheduledTime}</p>
          </div>
          <a href="tel:${phone}" style="display:block; text-align:center; background: linear-gradient(135deg, #8b5cf6, #d946ef); color: white; padding: 14px 28px; border-radius: 10px; text-decoration: none; font-weight: 700; font-size: 1rem;">
            📞 התקשר עכשיו
          </a>
        </div>
      `,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Email error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
