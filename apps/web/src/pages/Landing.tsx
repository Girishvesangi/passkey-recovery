import {Link} from 'react-router-dom';
import {useAuth} from '../auth/AuthContext';

export function Landing(){
    const { user, loading}=useAuth();
    if (loading) return <p> Loading...</p>

    return (
        <div>
            <h1> Passkey Recovery Lab</h1>
            <p> Passwordless sign-in with passkeys - and a way back in if you lose them.</p>
            {
                user?(
                    <p> Signed in as {user.username}.<Link to="/dashboard">Go to your dashboard</Link></p>
                ):(
                    <p>
                        <Link to="/register">Create an account</Link> . <Link to="/login">Log in</Link>
                    </p>
                )
            }
        </div>
    );

}