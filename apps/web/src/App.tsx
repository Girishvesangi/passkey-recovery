import type { ReactNode } from 'react';
import {Navigate, Route, Routes} from 'react-router-dom'
import { useAuth } from './auth/AuthContext';
import { Landing } from './pages/Landing';
import { RegisterPage } from './pages/RegisterPage';
import { LoginPage } from './pages/LoginPage';
import { Dashboard } from './pages/Dashboard';


function ProtectedRoute({children}:{children:ReactNode}){
  const {user, loading}=useAuth();
  if(loading) return <p>Loading...</p>
  if(!user) return <Navigate to="/login" replace/>;
  return <>{children}</>;
}

export default function App(){
  return (
    <Routes>
      <Route path="/" element={<Landing/>} />
      <Route path="/register" element={<RegisterPage/>}/>
      <Route path="/login" element={<LoginPage/>}/>
      <Route
      path="/dashboard"
      element={
        <ProtectedRoute>
          <Dashboard/>
        </ProtectedRoute>
      }
      />
      <Route path="*" element={<Navigate to="/" replace/>}/>
    </Routes>
  );
}