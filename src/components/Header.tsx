import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { auth } from '@/lib/api';
import { LogOut, BookOpen, Settings, FileText, Users } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getLogoUrl, onLogoUrlChange, hydrateLogoFromStorage } from '@/lib/branding';

interface HeaderProps {
  onLogout: () => void;
}

const Header = ({ onLogout }: HeaderProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';

  const [logoUrl, setLogoUrl] = useState<string | null>(() => getLogoUrl());

  useEffect(() => {
    const off = onLogoUrlChange(setLogoUrl);
    void hydrateLogoFromStorage();
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'branding:lastUpdated') setLogoUrl(getLogoUrl());
    };
    window.addEventListener('storage', onStorage);
    return () => {
      off();
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const handleLogout = async () => {
    try {
      await auth.logout();
    } finally {
      onLogout();
    }
  };

  const handleAttendanceClick = () => {
    navigate('/attendance');
  };

  return (
    <header className="bg-card border-b border-border shadow-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center overflow-hidden ${
              logoUrl ? 'bg-transparent' : 'bg-primary'
            }`}
          >
            {logoUrl ? (
              <img
                src={logoUrl}
                alt="Logo"
                className="h-8 w-8 object-contain select-none"
                tabIndex={-1}
                draggable={false}
                aria-hidden="true"
              />
            ) : (
              <BookOpen className="w-5 h-5 text-primary-foreground" />
            )}
          </div>
          <div>
            <h1 className="font-bold text-lg">Class Attendance Manager</h1>
            <div className="flex items-center gap-2">
              {isDemo && (
                <span className="text-xs text-muted-foreground bg-accent px-2 py-1 rounded">
                  Demo Mode
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <nav className="flex items-center gap-1">
            <Button 
              variant={location.pathname.startsWith('/attendance') ? 'default' : 'ghost'} 
              size="sm" 
              onClick={handleAttendanceClick}
              className="flex items-center gap-2"
            >
                <Users className="w-4 h-4" />
                Attendance
            </Button>

            <Button variant={location.pathname.startsWith('/classes') ? 'default' : 'ghost'} size="sm" asChild>
              <Link to="/classes" className="flex items-center gap-2">
                <BookOpen className="w-4 h-4" />
                Classes
              </Link>
            </Button>

            <Button variant={location.pathname === '/invoices' ? 'default' : 'ghost'} size="sm" asChild>
              <Link to="/invoices" className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Invoices
              </Link>
            </Button>

            <Button variant={location.pathname === '/settings' ? 'default' : 'ghost'} size="sm" asChild>
              <Link to="/settings" className="flex items-center gap-2">
                <Settings className="w-4 h-4" />
                Settings
              </Link>
            </Button>
          </nav>

          <Button
            variant="outline"
            size="sm"
            onClick={handleLogout}
            className="flex items-center gap-2 ml-2"
          >
            <LogOut className="w-4 h-4" />
            Logout
          </Button>
        </div>
      </div>
    </header>
  );
};

export default Header;
