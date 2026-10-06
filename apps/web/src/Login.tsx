import { startAuthentication } from '@simplewebauthn/browser';

export async function login() {
  const { flowId, options } = await (
    await fetch('http://localhost:3000/auth/options', { method: 'POST' })
  ).json();

  // Touch ID prompt. No username typed — the passkey identifies you.
  const authResp = await startAuthentication({ optionsJSON: options });

  const verifyRes = await fetch('http://localhost:3000/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include', // accept the session cookie
    body: JSON.stringify({ flowId, response: authResp }),
  });
  if (!verifyRes.ok) throw new Error('Login failed');
}
