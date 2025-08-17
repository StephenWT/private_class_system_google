import { useState, useEffect } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import LoginForm from '@/components/LoginForm';
import AttendanceManager from '@/pages/AttendanceManager';
import ClassManager from '@/components/ClassManager';
import StudentManager from '@/components/StudentManager';
import Header from '@/components/Header';
import { auth } from '@/lib/api';
import { getLastClassId } from '@/lib/nav';

const Index = () => {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const params = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    // Check if user is already authenticated
    const authenticated = auth.isAuthenticated();
    setIsAuthenticated(authenticated);
    setIsLoading(false);
    
    // Handle /attendance/last redirect
    if (authenticated && location.pathname === '/attendance/last') {
      const lastClassId = getLastClassId();
      if (lastClassId) {
        navigate(`/attendance/${lastClassId}`, { replace: true });
      } else {
        navigate('/attendance', { replace: true });
      }
    }
  }, []);

  const handleLoginSuccess = () => {
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
  };

  // Route-based rendering for authenticated users
  const renderAuthenticatedContent = () => {
    // Classes management
    if (location.pathname === '/classes') {
      return (
        <div className="min-h-screen bg-background">
          <Header onLogout={handleLogout} />
          <div className="container mx-auto px-4 py-8">
            <ClassManager />
          </div>
        </div>
      );
    }
    
    // Student management for specific class
    if (location.pathname.startsWith('/classes/') && location.pathname.endsWith('/students')) {
      const classId = params.classId;
      if (!classId) {
        navigate('/classes');
        return null;
      }
      
      return (
        <div className="min-h-screen bg-background">
          <Header onLogout={handleLogout} />
          <div className="container mx-auto px-4 py-8">
            <StudentManager classId={classId} />
          </div>
        </div>
      );
    }
    
    // Attendance (default and with class ID)
    return <AttendanceManager onLogout={handleLogout} />;
  };
  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-spin w-8 h-8 border-4 border-primary border-t-transparent rounded-full"></div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginForm onLoginSuccess={handleLoginSuccess} />;
  }

  return renderAuthenticatedContent();
};

export default Index;
