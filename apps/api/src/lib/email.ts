import type { AppEnv } from '../env';
import { logger } from './logger';

export async function sendPasswordResetEmail(
  env: AppEnv,
  to: string,
  resetUrl: string,
): Promise<void> {
  const from = env.EMAIL_FROM || 'Aether Vault <onboarding@resend.dev>';
  const apiKey = env.RESEND_API_KEY;

  if (!apiKey) {
    logger.info('Password reset link (email not configured — set RESEND_API_KEY)', {
      to,
      resetUrl,
    });
    return;
  }

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [to],
      subject: 'Reset your Aether Vault password',
      text: [
        'We received a request to reset your Aether Vault password.',
        '',
        `Open this link within 30 minutes to choose a new password:`,
        resetUrl,
        '',
        'If you did not request this, you can ignore this email.',
      ].join('\n'),
      html: `
        <p>We received a request to reset your Aether Vault password.</p>
        <p><a href="${resetUrl}">Reset your password</a></p>
        <p>This link expires in 30 minutes. If you did not request this, ignore this email.</p>
      `,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    logger.error('Failed to send reset email', { status: res.status, body });
    throw new Error('Failed to send reset email');
  }
}
