import { useState } from "react";
import { startRegistration } from "@simplewebauthn/browser";

const API='http://localhost:3000';

export function RegisterForm(){
    const [username,setUsername]=useState('');
    const [displayName, setDisplayName]=useState('');
    const [status,setStatus]=useState('');

    async function handleRegister(){
        try{
            setStatus('Requesting options....');
            const begin=await fetch(`${API}/register/options`,{
                method:'POST',
                headers:{'content-type':'application/json'},
                body: JSON.stringify({username,displayName}),
            }).then((r)=>r.json());
            if(!begin.flowId){
                setStatus(`Options failed: ${begin.error ?? 'unknown error'}`);
                return;
            }

            setStatus('Waiting for Touch ID...');
            const response =await startRegistration({optionsJSON:begin.options});

            setStatus('Verifying...');
            const result=await fetch(`${API}/register/verify`,{
                method:'POST',
                headers:{'content-type':'application/json'},
                credentials:'include',
                body:JSON.stringify({flowId:begin.flowId,response}),

            }).then((r)=>r.json());

            setStatus(result.ok? `Registered as ${result.username}!`:`Failed: ${result.error}`);
        } catch(err:any){
            setStatus(err?.name === 'NotAllowedError' ? 'Cancelled — no problem.' : `Error: ${err?.message ?? err}`);

        }
    }

    return (
        <div>
            <h2>Register a passkey</h2>
            <input placeholder="username" value={username} onChange={(e)=>setUsername(e.target.value)}/>
            <input placeholder="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
            <button onClick={handleRegister}>Register with Touch ID</button>
            <p>{status}</p>
        </div>
    );
}