import {Link, useNavigate } from 'react-router-dom';
import { RegisterForm } from '../RegisterForm';
import { useAuth } from '../auth/AuthContext';

export function RegisterPage(){
    const {refresh}= useAuth();
    const navigate =useNavigate();

    async function goToDashboard() {
        await refresh();
        navigate('/dashboard',{replace:true});

        
    }

    return (
        <div>
            <RegisterForm/>
            <button onClick={goToDashboard}>Continue to dashboard</button>
            <p>
                Already registered? <Link to="/login">Log in</Link>
            </p>
        </div>
    )
}