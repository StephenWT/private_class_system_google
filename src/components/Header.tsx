import { Button } from '@/components/ui/button';
import { auth } from '@/lib/api';
import { LogOut, BookOpen, Settings, FileText, Users } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';

interface HeaderProps {
  onLogout: () => void;
}

const Header = ({ onLogout }: HeaderProps) => {
  const location = useLocation();
  const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';

  const handleLogout = async () => {
    try {
      await auth.logout();
    } finally {
      onLogout();
    }
  };

  // Read ?tab=... from the current URL
  const params = new URLSearchParams(location.search);
  const activeTab = params.get('tab');

  // Treat "/?tab=classes" and any class-related routes as active for the Classes nav
  const isClassesRoute =
    (location.pathname === '/' && activeTab === 'classes') ||
    location.pathname.startsWith('/students') ||
    location.pathname.startsWith('/attendance') ||
    location.pathname.startsWith('/class');

  return (
    <header className="bg-card border-b border-border shadow-sm sticky top-0 z-50">
      <div className="container mx-auto px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-primary rounded-full flex items-center justify-center">
            <BookOpen className="w-5 h-5 text-primary-foreground" />
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
            {/* Go directly to the Manage Classes tab on the home page */}
            <Button variant={isClassesRoute ? 'default' : 'ghost'} size="sm" asChild>
              <Link to="/?tab=classes" className="flex items-center gap-2">
                <Users className="w-4 h-4" />
                Classes
              </Link>
            </Button>

            <Button
              variant={location.pathname === '/invoices' ? 'default' : 'ghost'}
              size="sm"
              asChild
            >
              <Link to="/invoices" className="flex items-center gap-2">
                <FileText className="w-4 h-4" />
                Invoices
              </Link>
            </Button>

            <Button
              variant={location.pathname === '/settings' ? 'default' : 'ghost'}
              size="sm"
              asChild
            >
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
