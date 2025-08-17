import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Settings as SettingsIcon, Database, Save, RotateCcw, Palette } from 'lucide-react';
import Header from '@/components/Header';

interface SettingsProps { onLogout: () => void }

// ===== Theme (used by receipts & invoices) =====
export type BillingTheme = {
  primary: string;   // main brand color
  secondary: string; // muted text
  accent: string;    // highlight/pill
  bg: string;        // paper background
  line: string;      // table borders
};

const THEME_KEY = 'billing_theme';
const DEFAULT_THEME: BillingTheme = {
  primary: '#2563EB',   // blue-600
  secondary: '#6B7280', // gray-500
  accent: '#F59E0B',    // amber-500
  bg: '#FFFFFF',
  line: '#E5E7EB',
};

const PRESETS: Record<string, BillingTheme> = {
  'Classic Blue': DEFAULT_THEME,
  'Emerald': { primary: '#059669', secondary: '#6B7280', accent: '#10B981', bg: '#FFFFFF', line: '#E5E7EB' },
  'Purple': { primary: '#7C3AED', secondary: '#6B7280', accent: '#A78BFA', bg: '#FFFFFF', line: '#E5E7EB' },
  'Rose': { primary: '#E11D48', secondary: '#6B7280', accent: '#FB7185', bg: '#FFFFFF', line: '#FFE4E6' },
  'Orange': { primary: '#EA580C', secondary: '#6B7280', accent: '#FDBA74', bg: '#FFFFFF', line: '#FFEAD5' },
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

  // ---- Supabase override (kept) ----
  const [supabaseUrl, setSupabaseUrl] = useState('');
  const [supabaseKey, setSupabaseKey] = useState('');
  const [isSavingDb, setIsSavingDb] = useState(false);

  // ---- Theme state ----
  const [theme, setTheme] = useState<BillingTheme>(() => loadTheme());
  const themePreviewCss = useMemo(() => {
    return `:root{--p:${theme.primary};--s:${theme.secondary};--a:${theme.accent};--bg:${theme.bg};--ln:${theme.line}}`;
  }, [theme]);

  useEffect(() => {
    // Load saved Supabase override
    const savedUrl = localStorage.getItem('custom_supabase_url');
    const savedKey = localStorage.getItem('custom_supabase_key');
    if (savedUrl) setSupabaseUrl(savedUrl);
    if (savedKey) setSupabaseKey(savedKey);
  }, []);

  // ===== Handlers: Supabase config =====
  const handleSaveDb = async () => {
    setIsSavingDb(true);
    try {
      if (supabaseUrl && supabaseKey) {
        try { new URL(supabaseUrl); } catch { throw new Error('Invalid Supabase URL format'); }
        localStorage.setItem('custom_supabase_url', supabaseUrl);
        localStorage.setItem('custom_supabase_key', supabaseKey);
        toast({ title: 'Settings saved', description: 'Custom Supabase configuration saved. Please refresh the page for changes.' });
      } else {
        throw new Error('Both URL and key are required');
      }
    } catch (error) {
      toast({ title: 'Save failed', description: error instanceof Error ? error.message : 'Failed to save settings', variant: 'destructive' });
    } finally { setIsSavingDb(false); }
  };

  const handleResetDb = () => {
    localStorage.removeItem('custom_supabase_url');
    localStorage.removeItem('custom_supabase_key');
    setSupabaseUrl('');
    setSupabaseKey('');
    toast({ title: 'Settings reset', description: 'Reverted to default Supabase configuration. Please refresh the page.' });
  };

  // ===== Handlers: Theme =====
  const saveTheme = () => {
    localStorage.setItem(THEME_KEY, JSON.stringify(theme));
    toast({ title: 'Theme saved', description: 'Invoices & receipts will use these colors.' });
  };
  const resetTheme = () => {
    setTheme(DEFAULT_THEME);
    localStorage.setItem(THEME_KEY, JSON.stringify(DEFAULT_THEME));
    toast({ title: 'Theme reset', description: 'Reverted to Classic Blue.' });
  };
  const applyPreset = (name: string) => {
    const preset = PRESETS[name];
    setTheme(preset);
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
            <CardDescription>Configure your own Supabase instance. Leave empty to use the default configuration.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="supabase-url">Supabase URL</Label>
              <Input id="supabase-url" placeholder="https://your-project.supabase.co" value={supabaseUrl} onChange={(e) => setSupabaseUrl(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="supabase-key">Supabase Anon Key</Label>
              <Input id="supabase-key" type="password" placeholder="Your Supabase anon key" value={supabaseKey} onChange={(e) => setSupabaseKey(e.target.value)} />
            </div>
            <div className="flex gap-2 pt-2">
              <Button onClick={handleSaveDb} disabled={isSavingDb || (!supabaseUrl && !supabaseKey)} className="flex items-center gap-2"><Save className="w-4 h-4" />{isSavingDb ? 'Saving…' : 'Save Configuration'}</Button>
              {isUsingCustomConfig && (
                <Button variant="outline" onClick={handleResetDb} className="flex items-center gap-2"><RotateCcw className="w-4 h-4" />Reset to Default</Button>
              )}
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
            <CardDescription>These colors are used by the <strong>Receipt</strong> (already wired) and your future <strong>Invoice</strong> design.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Presets */}
            <div>
              <Label className="mb-2 block">Presets</Label>
              <div className="flex flex-wrap gap-2">
                {Object.keys(PRESETS).map(name => (
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
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Primary</Label>
                <div className="flex items-center gap-2">
                  <Input type="color" value={theme.primary} onChange={(e) => setTheme({ ...theme, primary: e.target.value })} className="w-20 h-10 p-1" />
                  <Input value={theme.primary} onChange={(e) => setTheme({ ...theme, primary: e.target.value })} />
                </div>
                <p className="text-xs text-muted-foreground">Used for headers and emphasis.</p>
              </div>

              <div className="space-y-2">
                <Label>Accent</Label>
                <div className="flex items-center gap-2">
                  <Input type="color" value={theme.accent} onChange={(e) => setTheme({ ...theme, accent: e.target.value })} className="w-20 h-10 p-1" />
                  <Input value={theme.accent} onChange={(e) => setTheme({ ...theme, accent: e.target.value })} />
                </div>
                <p className="text-xs text-muted-foreground">Used for badges / totals.</p>
              </div>

              <div className="space-y-2">
                <Label>Secondary (muted text)</Label>
                <div className="flex items-center gap-2">
                  <Input type="color" value={theme.secondary} onChange={(e) => setTheme({ ...theme, secondary: e.target.value })} className="w-20 h-10 p-1" />
                  <Input value={theme.secondary} onChange={(e) => setTheme({ ...theme, secondary: e.target.value })} />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Paper Background</Label>
                <div className="flex items-center gap-2">
                  <Input type="color" value={theme.bg} onChange={(e) => setTheme({ ...theme, bg: e.target.value })} className="w-20 h-10 p-1" />
                  <Input value={theme.bg} onChange={(e) => setTheme({ ...theme, bg: e.target.value })} />
                </div>
              </div>

              <div className="space-y-2 md:col-span-2">
                <Label>Border / Line</Label>
                <div className="flex items-center gap-2">
                  <Input type="color" value={theme.line} onChange={(e) => setTheme({ ...theme, line: e.target.value })} className="w-20 h-10 p-1" />
                  <Input value={theme.line} onChange={(e) => setTheme({ ...theme, line: e.target.value })} />
                </div>
              </div>
            </div>

            {/* Live preview card */}
            <div className="border rounded-lg overflow-hidden" style={{ background: theme.bg }}>
              <style dangerouslySetInnerHTML={{ __html: themePreviewCss }} />
              <div style={{ background: 'var(--p)', color: 'white' }} className="px-4 py-3 font-bold">Receipt / Invoice Preview</div>
              <div className="p-4">
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <div className="font-semibold">Bill To</div>
                    <div className="text-[13px]" style={{ color: 'var(--s)' }}>Student Name</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">Issuer</div>
                    <div className="text-[13px]" style={{ color: 'var(--s)' }}>Your School</div>
                  </div>
                </div>
                <div className="mt-3 border rounded" style={{ borderColor: 'var(--ln)' }}>
                  <div className="grid grid-cols-4 text-xs px-3 py-2" style={{ background: '#00000008' }}>
                    <div className="text-left">Description</div>
                    <div className="text-right">Qty</div>
                    <div className="text-right">Unit</div>
                    <div className="text-right">Total</div>
                  </div>
                  <div className="grid grid-cols-4 text-sm px-3 py-2 border-t" style={{ borderColor: 'var(--ln)' }}>
                    <div className="text-left">Math (June)</div>
                    <div className="text-right">4</div>
                    <div className="text-right">$20.00</div>
                    <div className="text-right">$80.00</div>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2">
                  <div />
                  <div className="justify-self-end w-56 text-sm">
                    <div className="flex justify-between py-1"><span>Subtotal</span><span>$80.00</span></div>
                    <div className="flex justify-between py-1"><span>Paid</span><span>$20.00</span></div>
                    <div className="flex justify-between py-2 font-bold border-t mt-2" style={{ borderColor: 'var(--ln)' }}>
                      <span>Total Due</span>
                      <span className="px-2 rounded-full" style={{ background: 'var(--a)' }}>$60.00</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <Button onClick={saveTheme} className="flex items-center gap-2"><Save className="w-4 h-4" />Save Theme</Button>
              <Button variant="outline" onClick={resetTheme} className="flex items-center gap-2"><RotateCcw className="w-4 h-4" />Reset to Default</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
