import { useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { FileText, Calculator, Mail, Download, Sparkles } from 'lucide-react';
import { getLogoUrl, onLogoUrlChange, hydrateLogoFromStorage } from '@/lib/branding';

// ===== Theme (shared with Settings page) =====
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

// --- Types (local to this component) ---
interface UiStudent { id: string; student_name: string; parent_email?: string | null }
interface UiClass { id: string; class_name: string; hourly_rate?: number | null }
interface Summary {
  attended: number;
  total: number;
  unit: number; // chosen unit rate
  subtotal: number;
}

// --- Helpers ---
const currency = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '0.00');
const firstDayISO = (ym: string) => `${ym}-01`;
const nextMonthISO = (ym: string) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(y, m, 1); // month is 0-indexed; pass m for next month 1st
  return d.toISOString().slice(0, 10);
};

export default function InvoiceGenerator() {
  const { toast } = useToast();

  // Theme
  const [theme, setTheme] = useState<BillingTheme>(() => loadTheme());
  // pick up changes from Settings while app is open
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === THEME_KEY) setTheme(loadTheme());
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);
  const themeCss = `:root{--p:${theme.primary};--s:${theme.secondary};--a:${theme.accent};--bg:${theme.bg};--ln:${theme.line}}`;

  // Branding logo (live-updating from Settings)
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

  // Data
  const [classes, setClasses] = useState<UiClass[]>([]);
  const [students, setStudents] = useState<UiStudent[]>([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(''); // YYYY-MM

  // Pricing + summary
  const [hourlyRate, setHourlyRate] = useState<string>('');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [isBusy, setIsBusy] = useState(false);

  // Teacher/profile for the invoice heading
  const [teacherName, setTeacherName] = useState<string>('');
  const [schoolName, setSchoolName] = useState<string>('');
  const [teacherEmail, setTeacherEmail] = useState<string>('');

  const previewRef = useRef<HTMLDivElement | null>(null);

  // Load initial classes + profile
  useEffect(() => {
    (async () => {
      try {
        const { data: user } = await supabase.auth.getUser();
        const uid = user.user?.id;
        if (!uid) throw new Error('Not authenticated');

        const [{ data: cls, error: cErr }, { data: prof }] = await Promise.all([
          supabase.from('classes').select('id, class_name, hourly_rate').order('class_name'),
          supabase.from('profiles').select('full_name, school_name, email').eq('user_id', uid).single(),
        ]);
        if (cErr) throw cErr;
        setClasses((cls ?? []) as UiClass[]);
        setTeacherName((prof?.full_name as string) || '');
        setSchoolName((prof?.school_name as string) || '');
        setTeacherEmail((prof?.email as string) || '');
      } catch (e) {
        console.error(e);
        toast({ title: 'Could not load classes/profile', variant: 'destructive' });
      }
    })();
  }, [toast]);

  // When class changes, seed rate & load students actually enrolled in the class
  useEffect(() => {
    (async () => {
      setStudents([]);
      setSelectedStudentId('');
      setSummary(null);
      if (!selectedClassId) return;

      const cls = classes.find(c => c.id === selectedClassId);
      if (cls && cls.hourly_rate != null) setHourlyRate(String(cls.hourly_rate));

      try {
        // get distinct student_ids from lesson_schedules for this class
        const { data: scheds, error: sErr } = await supabase
          .from('lesson_schedules')
          .select('student_id')
          .eq('class_id', selectedClassId);
        if (sErr) throw sErr;
        const ids = Array.from(new Set((scheds ?? []).map(s => s.student_id)));
        if (ids.length === 0) { setStudents([]); return; }

        // fetch students by ids
        const { data: studs, error: stErr } = await supabase
          .from('students')
          .select('id, student_name, parent_email')
          .in('id', ids)
          .order('student_name');
        if (stErr) throw stErr;
        setStudents((studs ?? []) as UiStudent[]);
      } catch (e) {
        console.error(e);
        toast({ title: 'Could not load students for this class', variant: 'destructive' });
      }
    })();
  }, [selectedClassId, classes, toast]);

  // Recompute summary when all selectors filled
  useEffect(() => {
    if (selectedClassId && selectedStudentId && selectedMonth) {
      void computeSummary();
    } else {
      setSummary(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedClassId, selectedStudentId, selectedMonth, hourlyRate]);

  // --- Fixed summary calculation: manual override > per-lesson > class > 0 ---
  const computeSummary = async () => {
    setSummary(null);
    try {
      if (!selectedClassId || !selectedStudentId || !selectedMonth) return;

      const startISO = firstDayISO(selectedMonth); // inclusive
      const endISO = nextMonthISO(selectedMonth);  // exclusive

      // Get this student's schedules in the class for the month
      const { data: schedules, error: sErr } = await supabase
        .from('lesson_schedules')
        .select('id, hourly_rate, lesson_date')
        .eq('class_id', selectedClassId)
        .eq('student_id', selectedStudentId)
        .gte('lesson_date', startISO)
        .lt('lesson_date', endISO)
        .order('lesson_date');

      if (sErr) throw sErr;

      const scheduleIds = (schedules ?? []).map(s => s.id);
      const total = scheduleIds.length;

      // Count attended sessions
      let attended = 0;
      if (scheduleIds.length) {
        const { data: atts, error: aErr } = await supabase
          .from('attendance_records')
          .select('lesson_schedule_id, attended')
          .in('lesson_schedule_id', scheduleIds)
          .eq('student_id', selectedStudentId);

        if (aErr) throw aErr;
        attended = (atts ?? []).filter(a => a.attended).length;
      }

      // Rate precedence: manual override > per-lesson rate > class rate > 0
      const overrideRate = Number.parseFloat(String(hourlyRate).trim());
      const perLessonRate = (schedules ?? [])
        .map((s: any) => Number(s.hourly_rate))
        .find(n => Number.isFinite(n) && n > 0);
      const classRate = Number(
        classes.find(c => c.id === selectedClassId)?.hourly_rate ?? 0
      );

      const unit =
        (Number.isFinite(overrideRate) && overrideRate > 0) ? overrideRate
        : (Number.isFinite(perLessonRate as number) ? (perLessonRate as number)
        : (Number.isFinite(classRate) ? classRate : 0));

      const subtotal = attended * (unit || 0);
      setSummary({ attended, total, unit, subtotal });
    } catch (e) {
      console.error(e);
      toast({
        title: 'Failed to compute invoice',
        description: e instanceof Error ? e.message : undefined,
        variant: 'destructive',
      });
    }
  };

  const handleGenerateAndSave = async () => {
    if (!summary || !selectedClassId || !selectedStudentId || !selectedMonth) return;
    setIsBusy(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const teacherId = auth.user?.id;
      if (!teacherId) throw new Error('Not authenticated');

      // Invoice number via RPC (falls back to local pattern)
      let invoice_number: string | undefined;
      try {
        const { data: inv, error: invErr } = await supabase.rpc('generate_invoice_number');
        if (!invErr && inv) invoice_number = String(inv);
      } catch { /* ignore */ }
      if (!invoice_number) {
        const y = new Date().getFullYear();
        invoice_number = `INV-${y}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
      }

      const today = new Date();
      const due = new Date();
      due.setDate(due.getDate() + 14);

      // Create invoice
      const { data: invoice, error: invErr2 } = await supabase
        .from('invoices')
        .insert({
          invoice_number,
          teacher_id: teacherId,
          student_id: selectedStudentId,
          invoice_date: today.toISOString().slice(0, 10),
          due_date: due.toISOString().slice(0, 10),
          total_amount: summary.subtotal,
          tax_amount: 0,
          status: 'draft',
          notes: `Invoice for ${selectedMonth} — ${summary.attended}/${summary.total} sessions attended`,
        })
        .select()
        .single();
      if (invErr2) throw invErr2;

      // One consolidated line item
      const cls = classes.find(c => c.id === selectedClassId);
      const desc = `${cls?.class_name ?? 'Class'} — ${new Date(selectedMonth + '-01').toLocaleString('en-US', { month: 'long', year: 'numeric' })}`;

      const { error: liErr } = await supabase.from('invoice_line_items').insert({
        invoice_id: (invoice as any).id,
        description: desc,
        quantity: summary.attended,
        unit_price: summary.unit,
        total_price: summary.subtotal,
      });
      if (liErr) throw liErr;

      toast({ title: 'Invoice saved', description: invoice_number });
      return invoice as any;
    } catch (e) {
      console.error(e);
      toast({ title: 'Could not save invoice', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
      return null;
    } finally {
      setIsBusy(false);
    }
  };

  const handleEmailParent = async () => {
    if (!summary || !selectedStudentId) return;

    // Ensure we have an invoice row to reference (and to show up in trackers)
    const invoice = await handleGenerateAndSave();
    if (!invoice) return;

    const student = students.find(s => s.id === selectedStudentId);
    const cls = classes.find(c => c.id === selectedClassId);
    if (!student?.parent_email) {
      toast({ title: 'No parent email on file', variant: 'destructive' });
      return;
    }

    try {
      setIsBusy(true);

      const monthLabel = new Date(`${selectedMonth}-01`).toLocaleString('en-US', { month: 'long', year: 'numeric' });
      const subject = `Invoice ${invoice.invoice_number} · ${monthLabel}`;
      const body = `Hello,\n\nPlease find the invoice details below:\n\nStudent: ${student?.student_name}\nClass: ${cls?.class_name}\nBilling month: ${monthLabel}\nSessions attended: ${summary.attended}\nRate per session: $${currency(summary.unit)}\nTotal: $${currency(summary.subtotal)}\n\nThank you!\n${teacherName || ''}\n${teacherEmail ? 'Email: ' + teacherEmail : ''}\n\n(Generated by Class Attendance Manager)`;

      const mailto = `mailto:${encodeURIComponent(student.parent_email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

      // Optimistically mark as sent and open the user's mail client
      await supabase.from('invoices').update({ status: 'sent' }).eq('id', invoice.id);
      window.location.href = mailto;

      toast({ title: 'Opening your email app…', description: student.parent_email });
    } catch (e) {
      console.error(e);
      toast({ title: 'Failed to start email', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    } finally {
      setIsBusy(false);
    }
  };

  // Print via hidden iframe with a themed stylesheet so it looks like the preview
  // InvoiceGenerator.tsx
  const handleDownloadPdf = async () => {
    try {
      const node = previewRef.current;
      if (!node) { toast({ title: 'Nothing to print' }); return; }

      // Pull current theme variables you already compute
      const themeVars = themeCss; // ":root{--p:...;--s:...;--a:...;--bg:...;--ln:...}"

      const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Invoice</title>
  <style>
    ${themeVars}

    /* === Base & layout (no Tailwind at print time) === */
    * { box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
      color: #111;
      background: #fff;
      padding: 24px;
    }
    .invoice-paper { max-width: 900px; margin: 0 auto; }

    /* Utility equivalents used by your preview markup */
    .border       { border: 1px solid var(--ln); }
    .rounded-lg   { border-radius: 0.5rem; }
    .rounded-xl   { border-radius: 0.75rem; }
    .p-4 { padding: 1rem; } .p-6 { padding: 1.5rem; } .p-8 { padding: 2rem; }
    .px-3 { padding-left: .75rem; padding-right: .75rem; }
    .py-2 { padding-top: .5rem;  padding-bottom: .5rem; }
    .text-right { text-align: right; }
    .text-left  { text-align: left; }
    .text-sm { font-size: .875rem; line-height: 1.25rem; }
    .font-semibold { font-weight: 600; }
    .font-bold { font-weight: 700; }
    .font-extrabold { font-weight: 800; }
    .tracking-widest { letter-spacing: .1em; }
    .muted { color: var(--s); }
    .pill { display: inline-block; background: var(--a); color: #111; padding: 0 .5rem; border-radius: 999px; }

    /* Tables in your preview */
    table { width: 100%; border-collapse: collapse; margin-top: 8px; }
    thead th {
      background: #00000008;
      color: #111;
      text-align: right;
      padding: 10px;
      border-bottom: 1px solid var(--ln);
    }
    thead th:first-child, tbody td:first-child { text-align: left; }
    tbody td { padding: 12px; border-bottom: 1px solid var(--ln); text-align: right; }

    /* --- Tailwind size shims used by the logo wrapper (so print matches preview) --- */
    .h-12 { height: 3rem; }
    .w-12 { width: 3rem; }
    .rounded-full { border-radius: 9999px; }
    .object-contain { object-fit: contain; }
    .select-none { user-select: none; -webkit-user-select: none; }

    /* --- Constrain the logo ONLY in the print/PDF clone --- */
    .invoice-paper img[alt="Logo"] {
      max-height: 48px;
      max-width: 120px;
      object-fit: contain;
    }

    /* The blue header band in your preview uses inline style="background: var(--p); color: white" – ensure it prints */
    @media print {
      /* Force background colors to print exactly */
      * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

      /* Optional: tighten page margins */
      @page { margin: 12mm; }

      /* Hide any in-export UI controls (safety) */
      .no-print { display: none !important; }
    }
  </style>
</head>
<body>
  <div class="invoice-paper">${node.outerHTML}</div>
  <div class="no-print" style="margin-top:16px">
    <button onclick="window.print()" style="padding:10px 14px;border-radius:8px;border:1px solid var(--ln);background: var(--p); color: white; font-weight:700">
      Print
    </button>
  </div>
</body>
</html>`;

      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.right = '0';
      iframe.style.bottom = '0';
      iframe.style.width = '0';
      iframe.style.height = '0';
      iframe.style.border = '0';
      document.body.appendChild(iframe);

      const idoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!idoc) throw new Error('Could not open print document');

      idoc.open();
      idoc.write(html);
      idoc.close();

      const cleanup = () => setTimeout(() => { try { document.body.removeChild(iframe); } catch {} }, 0);
      iframe.contentWindow?.addEventListener('afterprint', cleanup);
      setTimeout(cleanup, 30000);

      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();

      toast({ title: 'Print dialog opened (enable “Background graphics” if your browser asks)' });
    } catch (e) {
      console.error(e);
      toast({ title: 'Print failed', description: e instanceof Error ? e.message : undefined, variant: 'destructive' });
    }
  };

  // Derived values
  const selectedClass = useMemo(() => classes.find(c => c.id === selectedClassId) || null, [classes, selectedClassId]);
  const selectedStudent = useMemo(() => students.find(s => s.id === selectedStudentId) || null, [students, selectedStudentId]);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileText className="w-5 h-5 text-primary" />
          <CardTitle>Generate Invoice</CardTitle>
          <Badge variant="secondary" className="ml-2">Attendance-based</Badge>
        </div>
        <CardDescription>Create invoices from recorded attendance; then email or export as PDF.</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Controls */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label>Class</Label>
            <Select value={selectedClassId} onValueChange={(v) => setSelectedClassId(v)}>
              <SelectTrigger>
                <SelectValue placeholder="Select class" />
              </SelectTrigger>
              <SelectContent>
                {classes.map(c => (
                  <SelectItem key={c.id} value={c.id}>{c.class_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Student</Label>
            <Select value={selectedStudentId} onValueChange={setSelectedStudentId} disabled={!selectedClassId}>
              <SelectTrigger>
                <SelectValue placeholder={selectedClassId ? 'Select student' : 'Select class first'} />
              </SelectTrigger>
              <SelectContent>
                {students.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.student_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Month</Label>
            <Input type="month" value={selectedMonth} onChange={(e) => setSelectedMonth(e.target.value)} placeholder="YYYY-MM" />
          </div>

          <div className="space-y-2">
            <Label>Rate per session</Label>
            <Input type="number" step="0.01" value={hourlyRate} onChange={(e) => setHourlyRate(e.target.value)} />
            <p className="text-xs text-muted-foreground">Defaults to class or lesson rate; you can override.</p>
          </div>
        </div>

        {/* Summary */}
        {summary && (
          <Card className="bg-accent/20">
            <CardContent className="pt-6">
              <div className="flex items-center gap-2 mb-3">
                <Calculator className="w-4 h-4 text-primary" />
                <h4 className="font-semibold">Attendance Summary</h4>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                <div><span className="text-muted-foreground">Sessions attended</span><div className="font-bold">{summary.attended}</div></div>
                <div><span className="text-muted-foreground">Total scheduled</span><div className="font-bold">{summary.total}</div></div>
                <div><span className="text-muted-foreground">Rate per session</span><div className="font-bold">${currency(summary.unit)}</div></div>
                <div><span className="text-muted-foreground">Subtotal</span><div className="font-bold text-primary">${currency(summary.subtotal)}</div></div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Invoice Preview (themed layout) */}
        {summary && selectedClass && selectedStudent && (
          <div ref={previewRef} className="invoice-paper border rounded-xl overflow-hidden print:bg-white" style={{ borderColor: 'var(--ln)', background: 'var(--bg)' }}>
            <style dangerouslySetInnerHTML={{ __html: themeCss }} />

            {/* Brand header band */}
            <div className="px-6 py-4" style={{ background: 'var(--p)', color: 'white' }}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`h-12 w-12 rounded-full flex items-center justify-center overflow-hidden ${logoUrl ? 'bg-transparent' : 'bg-white/10'}`}
                    aria-hidden="true"
                  >
                    {logoUrl ? (
                      <img
                        src={logoUrl}
                        alt="Logo"
                        className="h-12 w-12 object-contain select-none"
                        tabIndex={-1}
                        draggable={false}
                      />
                    ) : (
                      <span className="text-[10px] font-bold px-2 opacity-90">LOGO</span>
                    )}
                  </div>
                  <div>
                    <div className="text-xl md:text-2xl font-bold">{schoolName || teacherName || 'Your Name'}</div>
                    {teacherEmail && <div className="text-xs opacity-95">{teacherEmail}</div>}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-2xl md:text-3xl font-extrabold tracking-widest">INVOICE</div>
                  <div className="text-[11px] opacity-95">{new Date().toLocaleDateString()}</div>
                </div>
              </div>
            </div>

            {/* Body */}
            <div className="p-8 bg-white">
              {/* Meta boxes */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                <div className="border rounded-lg p-4" style={{ borderColor: 'var(--ln)' }}>
                  <div className="font-semibold mb-1">Bill To</div>
                  <div className="text-sm">{selectedStudent.student_name}</div>
                  {selectedStudent.parent_email && (
                    <div className="text-sm" style={{ color: 'var(--s)' }}>{selectedStudent.parent_email}</div>
                  )}
                </div>
                <div className="border rounded-lg p-4" style={{ borderColor: 'var(--ln)' }}>
                  <div className="font-semibold mb-1">Invoice Details</div>
                  <div className="text-sm">Class: {selectedClass.class_name}</div>
                  <div className="text-sm">Billing month: {new Date(`${selectedMonth}-01`).toLocaleString('en-US', { month: 'long', year: 'numeric' })}</div>
                  <div className="text-sm">Invoice date: {new Date().toLocaleDateString('en-US')}</div>
                  <div className="text-sm">Due date: {(() => { const d = new Date(); d.setDate(d.getDate() + 14); return d.toLocaleDateString('en-US'); })()}</div>
                </div>
              </div>

              {/* Line items */}
              <div className="overflow-hidden border rounded" style={{ borderColor: 'var(--ln)' }}>
                <table className="w-full text-sm">
                  <thead>
                    <tr style={{ background: '#00000008' }}>
                      <th className="text-left py-2 px-3">Description</th>
                      <th className="text-right py-2 px-3">Qty</th>
                      <th className="text-right py-2 px-3">Unit</th>
                      <th className="text-right py-2 px-3">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t" style={{ borderColor: 'var(--ln)' }}>
                      <td className="py-3 px-3">
                        {selectedClass.class_name} — {new Date(`${selectedMonth}-01`).toLocaleString('en-US', { month: 'long', year: 'numeric' })}
                      </td>
                      <td className="py-3 px-3 text-right">{summary.attended}</td>
                      <td className="py-3 px-3 text-right">${currency(summary.unit)}</td>
                      <td className="py-3 px-3 text-right font-semibold">${currency(summary.subtotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              {/* Totals & notes */}
              <div className="flex justify-between items-start mt-6">
                <div className="text-xs max-w-md" style={{ color: 'var(--s)' }}>
                  <div className="font-medium text-foreground mb-1" style={{ color: '#111' }}>Notes</div>
                  Invoice generated from attendance records.
                </div>
                <div className="w-full md:w-72">
                  <div className="flex justify-between py-1 text-sm"><span>Subtotal</span><span>${currency(summary.subtotal)}</span></div>
                  <div className="flex justify-between py-1 text-sm"><span>Tax</span><span>$0.00</span></div>
                  <div className="flex justify-between py-2 text-base font-bold border-t mt-2" style={{ borderColor: 'var(--ln)' }}><span>Total</span><span className="px-2 rounded-full" style={{ background: 'var(--a)', color: '#111' }}>${currency(summary.subtotal)}</span></div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <Button onClick={handleGenerateAndSave} disabled={!summary || isBusy} className="flex items-center gap-2">
            <Sparkles className="w-4 h-4" />
            {isBusy ? 'Saving…' : 'Generate & Save'}
          </Button>
          <Button variant="outline" onClick={handleDownloadPdf} disabled={!summary || isBusy} className="flex items-center gap-2">
            <Download className="w-4 h-4" />
            Print / Save PDF
          </Button>
          <Button variant="outline" onClick={handleEmailParent} disabled={!summary || isBusy} className="flex items-center gap-2">
            <Mail className="w-4 h-4" />
            Email to Parent
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
