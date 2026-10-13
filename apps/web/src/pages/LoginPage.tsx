import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { login } from '../Login';
import { useAuth } from '../auth/AuthContext';

export function LoginPage() {
  const [status, setStatus] = useState('');
  const { refresh } = useAuth();
  const navigate = useNavigate();

  async function handleLogin() {
    try {
      setStatus('Waiting for Touch ID…');
      await login();
      await refresh();
      navigate('/dashboard', { replace: true });
    } catch {
      setStatus('Login failed');
    }
  }

  return (
    <div>
      <h2>Log in with your passkey</h2>
      <button onClick={handleLogin}>Log in with Touch ID</button>
      <p>{status}</p>
      <p>
        New here? <Link to="/register">Create an account</Link>
      </p>
    </div>
  );
}
