import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";

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
    const { user, logout}= useAuth();
    const navigate=useNavigate();
    const [passkeys, setPasskeys]=useState<Passkey[]>([]);
    const [status, setStatus]=useState('Loading your passkeys...');

    useEffect(()=>{
        fetch('http://localhost:3000/passkeys', {credentials:'include'})
        .then((r)=>(r.ok? r.json():Promise.reject(new Error('failed'))))
        .then((rows)=>{
            setPasskeys(rows);
            setStatus('');
        })
        .catch(()=> setStatus('Could not load your passkeys.'));
    },[]);

    async function handleLogout(){
        await logout();
        navigate('/login',{replace:true});
    }

    return (
        <div>
            <h2>Dashboard</h2>
            <p> Signed in as {user?.display_name} (@{user?.username})</p>
            <button onClick={handleLogout}>Log out</button>

            <h3>Your passkeys</h3>
            {status && <p>{status}</p>}
            <ul>
                {passkeys.map((pk)=>(
                    <li key={pk.credential_id}>
                        {pk.label ?? 'Unnamed passkey'}- {pk.device_type ?? 'unknown device'}
                        {pk.backed_up?', synced':', this device only'}
                        <br/>
                        Created {new Date(pk.created_at).toLocaleString()}.Last used{' '}
                        {pk.last_used_at ? new Date(pk.last_used_at).toLocaleString() : 'never'}
                        {pk.revoked_at ? ' · REVOKED' : ''}

                    </li>
                ))}
            </ul>
        </div>
    )

    
}