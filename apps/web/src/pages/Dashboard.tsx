import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { startRegistration } from "@simplewebauthn/browser";

type Passkey={
    credential_id: string;
    label:string |null;
    device_type: string |null;
    backed_up:boolean|null;
    counter: number;
    created_at: string;
    last_used_at: string |null;
    revoked_at:string|null;
};

export function Dashboard(){
    const { user, logout, refresh}= useAuth();
    const navigate=useNavigate();
    const [passkeys, setPasskeys]=useState<Passkey[]>([]);
    const [status, setStatus]=useState('Loading your passkeys...');
    const [editingId, setEditingId]=useState<String |null>(null);
    const [labelInput, setLabelInput]=useState('');

    async function loadPasskeys() {
  try {
    const r = await fetch('http://localhost:3000/passkeys', { credentials: 'include' });
    if (!r.ok) throw new Error('failed');
    setPasskeys(await r.json());
    setStatus('');
  } catch {
    setStatus('Could not load your passkeys.');
  }
}

useEffect(() => {
  loadPasskeys();
}, []);


    function startRename(pk:Passkey){
        setEditingId(pk.credential_id);
        setLabelInput(pk.label ?? '');
    }

    async function saveRename(pk:Passkey){
        const res= await fetch(`http://localhost:3000/passkeys/${pk.credential_id}`,{
            method:'PATCH',
            credentials:'include',
            headers:{'content-type':'application/json'},
            body:JSON.stringify({label:labelInput}),
    });
    if(!res.ok){
        setStatus('Rename failed');
        return;
    }
    setPasskeys((list)=>
    list.map((p)=>(p.credential_id===pk.credential_id?{...p,label:labelInput}:p)),
);
setEditingId(null);
    }

    async function revokePasskey(pk: Passkey){
        if( !window.confirm(`Revoke "${pk.label ?? 'Unnamed passkey'}"? It will never be able to log in again `)) return;
        const res= await fetch(`http://localhost:3000/passkeys/${pk.credential_id}/revoke`,{
            method:'POST',
            credentials:'include',
        });
        const data= await res.json().catch(()=>({}));
        if(!res.ok){
            setStatus(data.error ?? 'Revoke failed');
            return;
        }
        setPasskeys((list)=>
        list.map((p)=>
            p.credential_id===pk.credential_id?{...p,revoked_at:new Date().toISOString()}:p,
        ),);
    }

    async function addPasskey() {
  try {
    setStatus('Requesting options…');
    const begin = await fetch('http://localhost:3000/passkeys/register/options', {
      method: 'POST',
      credentials: 'include',
    }).then((r) => r.json());
    if (!begin.flowId) {
      setStatus(`Could not start: ${begin.error ?? 'unknown error'}`);
      return;
    }

    setStatus('Waiting for Touch ID…');
    const response = await startRegistration({ optionsJSON: begin.options });

    const result = await fetch('http://localhost:3000/passkeys/register/verify', {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ flowId: begin.flowId, response }),
    }).then((r) => r.json());

    if (!result.ok) {
      setStatus(`Failed: ${result.error ?? 'unknown error'}`);
      return;
    }
    setStatus('');
    await loadPasskeys();
  } catch (err: any) {
    setStatus(err?.name === 'NotAllowedError' ? 'Cancelled — no problem.' : `Error: ${err?.message ?? err}`);
  }
}


    async function handleLogout(){
        await logout();
        navigate('/login',{replace:true});
    }

    async function logoutAll() {
        await fetch('http://localhost:3000/logout-all', {
    method: 'POST',
    credentials: 'include',
    });
    await refresh();
  navigate('/login', { replace: true });
}

    

    return (
        <div>
            <h2>Dashboard</h2>
            <p> Signed in as {user?.display_name} (@{user?.username})</p>
            <button onClick={handleLogout}>Log out</button>
            <button onClick={addPasskey}>Add a passkey</button>
            <button onClick={logoutAll}>Sign out everywhere</button>



            <h3>Your passkeys</h3>
            {status && <p>{status}</p>}
            <ul>
                {passkeys.map((pk)=>(
                    <li key={pk.credential_id}>
                      {editingId === pk.credential_id ? (
              <>
                <input value={labelInput} onChange={(e) => setLabelInput(e.target.value)} />
                <button onClick={() => saveRename(pk)}>Save</button>
                <button onClick={() => setEditingId(null)}>Cancel</button>
              </>
            ) : (
              <>
                {pk.label ?? 'Unnamed passkey'} — {pk.device_type ?? 'unknown device'}
                {pk.backed_up ? ', synced' : ', this device only'}
                {!pk.revoked_at && <button onClick={() => startRename(pk)}>Rename</button>}
                {!pk.revoked_at && <button onClick={() => revokePasskey(pk)}>Revoke</button>}
                

              </>
            )}
            <br />
            Created {new Date(pk.created_at).toLocaleString()} · Last used{' '}
            {pk.last_used_at ? new Date(pk.last_used_at).toLocaleString() : 'never'}
            {pk.revoked_at ? ' · REVOKED' : ''}
                    </li>
                ))}
            </ul>
        </div>
    )

    
}