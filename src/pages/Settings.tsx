import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import {
  Settings as SettingsIcon,
  Database,
  Save,
  RotateCcw,
  Palette,
  Image as ImageIcon,
  Upload,
  Trash2,
} from 'lucide-react';
import Header from '@/components/Header';
import { getLogoUrl, uploadLogoFile, removeLogo } from '@/lib/branding';

interface SettingsProps {
  onLogout: () => void;
}

export type BillingTheme = {
  primary: string;
  secondary: string;
  accent: string;
  bg: string;
  line: string;
};

const THEME_KEY = 'billing_theme';
const DEFAULT_THEME: BillingTheme = {
  primary: '#2563EB',
  secondary: '#6B7280',
  accent: '#F59E0B',
  bg: '#FFFFFF',
  line: '#E5E7EB',
};

const PRESETS: Record<string, BillingTheme> = {
  'Classic Blue': DEFAULT_THEME,
  Emerald: { primary: '#059669', secondary: '#6B7280', accent: '#10B981', bg: '#FFFFFF', line: '#E5E7EB' },
  Purple: { primary: '#7C3AED', secondary: '#6B7280', accent: '#A78BFA', bg: '#FFFFFF', line: '#E5E7EB' },
  Rose: { primary: '#E11D48', secondary: '#6B7280', accent: '#FB7185', bg: '#FFFFFF', line: '#FFE4E6' },
  Orange: { primary: '#EA580C', secondary: '#6B7280', accent: '#FDBA74', bg: '#FFFFFF', line: '#FFEAD5' },
};

function loadTheme(): BillingTheme {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (!raw) return DEFAULT_THEME;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_THEME, ...parsed } as BillingTheme;
  } catch {
    return DEFAULT_THEME;
  }
}

export default function Settings({ onLogout }: SettingsProps) {
  const { toast } = useToast();

  // Supabase override
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');
  const [isSavingDb, setIsSavingDb] = useState(false);

  // Theme
  const [theme, setTheme] = useState<BillingTheme>(() => loadTheme());
  const themePreviewCss = useMemo(
    () => `:root{--p:${theme.primary};--s:${theme.secondary};--a:${theme.accent};--bg:${theme.bg};--ln:${theme.line}}`,
    [theme]
  );

  // Logo
  const [logoUrl, setLogoUrl] = useState<string | null>(() => getLogoUrl());
  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const savedUrl = localStorage.getItem('custom_supabase_url');
    const savedKey = localStorage.getItem('custom_supabase_key');
    if (savedUrl) setSupabaseUrl(savedUrl);
    if (savedKey) setSupabaseKey(savedKey);
  }, []);

  // Keep preview in sync if other tabs update the logo
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'branding:lastUpdated') {
        setLogoUrl(getLogoUrl());
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Supabase config handlers
  const handleSaveDb = async () => {
    setIsSavingDb(true);
    try {
      if (!supabaseUrl || !supabaseKey) throw new Error('Both URL and key are required');
      try {
        new URL(supabaseUrl);
      } catch {
        throw new Error('Invalid Supabase URL format');
      }
      localStorage.setItem('custom_supabase_url', supabaseUrl);
      localStorage.setItem('custom_supabase_key', supabaseKey);
      toast({
        title: 'Settings saved',
        description: 'Custom Supabase configuration saved. Please refresh the page for changes.',
      });
    } catch (error) {
      toast({
        title: 'Save failed',
        description: error instanceof Error ? error.message : 'Failed to save settings',
        variant: 'destructive',
      });
    } finally {
      setIsSavingDb(false);
    }
  };

  const handleResetDb = () => {
    localStorage.removeItem('custom_supabase_url');
    localStorage.removeItem('custom_supabase_key');
    setSupabaseUrl('');
    setSupabaseKey('');
    toast({
      title: 'Settings reset',
      description: 'Reverted to default Supabase configuration. Please refresh the page.',
    });
  };

  // Theme handlers
  const saveTheme = () => {
    localStorage.setItem(THEME_KEY, JSON.stringify(theme));
    toast({ title: 'Theme saved', description: 'Invoices & receipts will use these colors.' });
  };
  const resetTheme = () => {
    setTheme(DEFAULT_THEME);
    localStorage.setItem(THEME_KEY, JSON.stringify(DEFAULT_THEME));
    toast({ title: 'Theme reset', description: 'Reverted to Classic Blue.' });
  };
  const applyPreset = (name: string) => setTheme(PRESETS[name]);

  // Logo handlers
  const onChooseLogo = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    if (!file) return;
    if (file.size > 1024 * 1024) {
      toast({ title: 'File too large', description: 'Max 1MB', variant: 'destructive' });
      return;
    }
    setLogoFile(file);
  };

  const onUploadLogo = async () => {
    if (!logoFile) return;
    try {
      setUploading(true);
      const url = await uploadLogoFile(logoFile);
      setLogoUrl(url);
      setLogoFile(null);
      toast({ title: 'Logo uploaded', description: 'Your header will show the new logo.' });
    } catch (e) {
      toast({
        title: 'Upload failed',
        description: e instanceof Error ? e.message : 'Please try again.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
    }
  };

  const onRemoveLogo = async () => {
    try {
      await removeLogo();
      setLogoUrl(null);
      setLogoFile(null);
      toast({ title: 'Logo removed' });
    } catch (e) {
      toast({
        title: 'Remove failed',
        description: e instanceof Error ? e.message : 'Please try again.',
        variant: 'destructive',
      });
    }
  };

  const isUsingCustomConfig = Boolean(localStorage.getItem('custom_supabase_url'));

  return (
    <div className="min-h-screen bg-background">
      <Header onLogout={onLogout} />

      <div className="container mx-auto px-4 py-8 max-w-4xl space-y-8">
        <div className="flex items-center gap-3">
          <SettingsIcon className="w-6 h-6 text-primary" />
          <h1 className="text-2xl font-bold">Settings</h1>
        </div>

        {/* Supabase */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Database className="w-5 h-5 text-primary" />
              <CardTitle>Supabase Configuration</CardTitle>
            </div>
            <CardDescription>
              Configure your own Supabase instance. Leave empty to use the default configuration.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="supabase-url">Supabase URL</Label>
              <Input
                id="supabase-url"
                placeholder="https://your-project.supabase.co"
                value={supabaseUrl}
                onChange={(e) => setSupabaseUrl(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supabase-key">Supabase Anon Key</Label>
              <Input
                id="supabase-key"
                type="password"
                placeholder="Your Supabase anon key"
                value={supabaseKey}
                onChange={(e) => setSupabaseKey(e.target.value)}
              />
            </div>
            <div className="flex gap-2 pt-2">
              <Button
                onClick={handleSaveDb}
                disabled={isSavingDb || (!supabaseUrl && !supabaseKey)}
                className="flex items-center gap-2"
              >
                <Save className="w-4 h-4" />
                {isSavingDb ? 'Saving…' : 'Save Configuration'}
              </Button>
              {isUsingCustomConfig && (
                <Button variant="outline" onClick={handleResetDb} className="flex items-center gap-2">
                  <RotateCcw className="w-4 h-4" />
                  Reset to Default
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Logo & Branding */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ImageIcon className="w-5 h-5 text-primary" />
              <CardTitle>Logo & Branding</CardTitle>
            </div>
            <CardDescription>Upload a logo to display in the header and on printed documents.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Preview */}
              <div>
                <Label>Preview</Label>
                <div className="mt-2 p-4 border rounded-lg bg-card flex items-center gap-4">
                  <div
                    className={`h-12 w-12 rounded-full flex items-center justify-center overflow-hidden ${
                      logoUrl ? 'bg-transparent' : 'bg-primary'
                    }`}
                  >
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt="Logo"
                        className="h-12 w-12 object-contain select-none"
                        draggable={false}
                      />
                    ) : (
                      <ImageIcon className="w-5 h-5 text-primary-foreground" />
                    )}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Header shows the logo at ~32px tall. Use a square PNG/SVG for best results.
                  </div>
                </div>
              </div>

              {/* Uploader */}
              <div>
                <Label>Upload Logo</Label>
                <div className="mt-2 flex flex-col gap-3">
                  <Input
                    type="file"
                    accept="image/png,image/jpeg,image/svg+xml,image/webp"
                    onChange={onChooseLogo}
                  />
                  <div className="flex items-center gap-2">
                    <Button onClick={onUploadLogo} disabled={!logoFile || uploading} className="flex items-center gap-2">
                      <Upload className="w-4 h-4" />
                      {uploading ? 'Uploading…' : 'Upload'}
                    </Button>
                    {logoUrl && (
                      <Button variant="outline" onClick={onRemoveLogo} className="flex items-center gap-2">
                        <Trash2 className="w-4 h-4" />
                        Remove
                      </Button>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-5">
                    <strong>Recommended:</strong> Transparent PNG or SVG, square. <br />
                    <strong>Target canvas:</strong> ~128×128px (we scale automatically). <br />
                    <strong>Max file:</strong> 1MB.
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Branding / Colors */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Palette className="w-5 h-5 text-primary" />
              <CardTitle>Branding & Colors</CardTitle>
            </div>
            <CardDescription>
              These colors are used by the <strong>Receipt</strong> and your <strong>Invoice</strong> design.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Presets */}
            <div>
              <Label className="mb-2 block">Presets</Label>
              <div className="flex flex-wrap gap-2">
                {Object.keys(PRESETS).map((name) => (
                  <Button key={name} type="button" variant="outline" size="sm" onClick={() => applyPreset(name)}>
                    <span className="inline-flex items-center gap-2">
                      <span className="w-4 h-4 rounded" style={{ background: PRESETS[name].primary }} />
                      <span>{name}</span>
                    </span>
                  </Button>
                ))}
              </div>
            </div>

            {/* Pickers */}
            <style dangerouslySetInnerHTML={{ __html: themePreviewCss }} />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Primary</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={theme.primary}
                    onChange={(e) => setTheme({ ...theme, primary: e.target.value })}
                    className="w-20 h-10 p-1"
                  />
                  <Input value={theme.primary} onChange={(e) => setTheme({ ...theme, primary: e.target.value })} />
                </div>
                <p className="text-xs text-muted-foreground">Used for headers and emphasis.</p>
              </div>

              <div className="space-y-2">
                <Label>Accent</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={theme.accent}
                    onChange={(e) => setTheme({ ...theme, accent: e.target.value })}
                    className="w-20 h-10 p-1"
                  />
                  <Input value={theme.accent} onChange={(e) => setTheme({ ...theme, accent: e.target.value })} />
                </div>
                <p className="text-xs text-muted-foreground">Used for badges / totals.</p>
              </div>

              <div className="space-y-2">
                <Label>Secondary (muted text)</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={theme.secondary}
                    onChange={(e) => setTheme({ ...theme, secondary: e.target.value })}
                    className="w-20 h-10 p-1"
                  />
                  <Input value={theme.secondary} onChange={(e) => setTheme({ ...theme, secondary: e.target.value })} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Paper Background</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={theme.bg}
                    onChange={(e) => setTheme({ ...theme, bg: e.target.value })}
                    className="w-20 h-10 p-1"
                  />
                  <Input value={theme.bg} onChange={(e) => setTheme({ ...theme, bg: e.target.value })} />
                </div>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>Border / Line</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="color"
                    value={theme.line}
                    onChange={(e) => setTheme({ ...theme, line: e.target.value })}
                    className="w-20 h-10 p-1"
                  />
                  <Input value={theme.line} onChange={(e) => setTheme({ ...theme, line: e.target.value })} />
                </div>
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={saveTheme} className="flex items-center gap-2">
                <Save className="w-4 h-4" />
                Save Colors
              </Button>
              <Button variant="outline" onClick={resetTheme} className="flex items-center gap-2">
                <RotateCcw className="w-4 h-4" />
                Reset
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
