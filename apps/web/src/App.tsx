import { useEffect, useState } from 'react'
import './App.css'
import { RegisterForm } from './RegisterForm';
import { startAuthentication } from '@simplewebauthn/browser';
function App() {
  const [status, setStatus]=useState('checking...');
  useEffect(()=>{
    fetch('http://localhost:3000/health')
      .then(r=>r.json())
      .then(j=>setStatus(j.database==='ok'?'API connected':'API up, DB down'))
      .catch(()=>setStatus('API unreachable'));
  },[]);

  async function login() {
  const { flowId, options } = await (
    await fetch('http://localhost:3000/auth/options', { method: 'POST' })
  ).json();
  const authResp = await startAuthentication({ optionsJSON: options });
  const verifyRes = await fetch('http://localhost:3000/auth/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ flowId, response: authResp }),
  });
  if (!verifyRes.ok) throw new Error('Login failed');
}


  async function handleLogin() {
  try {
    setStatus('Waiting for Touch ID…');
    await login();
    setStatus('Logged in!');
  } catch {
    setStatus('Login failed');
  }
}

  return <>
  <h1>{status}</h1>
  <RegisterForm/>
  <button onClick={handleLogin}>Log in with passkey</button>
  <p>{status}</p>
  </>
  
}

export default App
