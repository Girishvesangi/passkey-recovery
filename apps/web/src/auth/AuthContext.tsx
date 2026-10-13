import { createContext, useContext, useEffect, useState} from 'react';
import type { ReactNode} from 'react';

export type User ={
    id:number;
    username:string;
    display_name:string;
};

type AuthState={
    user: User | null;
    loading:boolean;
    refresh:()=>Promise<void>;
    logout:()=> Promise<void>;
};

const AuthContext= createContext<AuthState| null>(null);

export function AuthProvider({children}:{children:ReactNode}){
    const [user,setUser]= useState<User|null>(null);
    const [loading,setLoading]=useState(true);

    async function refresh(){
        try{
            const res=await fetch('http://localhost:3000/me',{
                credentials:'include',
            });
            setUser(res.ok ? await res.json(): null);
        } catch{
            setUser(null);
        } finally{
            setLoading(false);
        }
    }

    async function logout() {
        await fetch('http://localhost:3000/logout',{
            method:'POST',
            credentials:'include',
        });
        setUser(null);
    }

    useEffect(()=>{
        refresh();
    },[]);

    return (
        <AuthContext.Provider value={{user,loading,refresh,logout}}>
        {children}
        </AuthContext.Provider>
    );
}

export function useAuth(){
    const ctx=useContext(AuthContext);
    if(!ctx) throw new Error('useAuth must be used inside AuthProvider');
    return ctx;
}