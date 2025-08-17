import { useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { DollarSign, Receipt, CheckCircle, Clock, AlertCircle, FileText, Trash2, RotateCcw } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { getLogoUrl, onLogoUrlChange, hydrateLogoFromStorage } from '@/lib/branding';
import { Label } from '@/components/ui/label';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type PaymentMethodType = 'cash' | 'bank_transfer' | 'card' | 'cheque' | 'other';

/**
 * PaymentTracker:
 * - Delete invoice (single + bulk) with themed confirm dialog
 * - Undo last payment with themed confirm dialog
 * - Themed receipt print (reads colors from localStorage `billing_theme`)
 */

const THEME_KEY = 'billing_theme';
const defaultTheme = {
  primary: '#2563EB',
  secondary: '#6B7280',
  accent: '#F59E0B',
  bg: '#FFFFFF',
  line: '#E5E7EB',
};

const getTheme = () => {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (!raw) return defaultTheme;
    const parsed = JSON.parse(raw);
    return { ...defaultTheme, ...parsed };
  } catch {
    return defaultTheme;
  }
};

interface InvoiceRow {
  id: string;
  invoice_number: string;
  student_id: string;
  student_name: string;
  total_amount: number;
  due_date: string;
  status: 'draft' | 'sent' | 'paid' | 'overdue' | 'cancelled';
}

const getStatusIcon = (status: InvoiceRow['status']) => {
  switch (status) {
    case 'paid':     return <CheckCircle className="w-4 h-4 text-green-600" />;
    case 'overdue':  return <AlertCircle className="w-4 h-4 text-red-600" />;
    case 'sent':     return <Clock className="w-4 h-4 text-amber-600" />;
    case 'cancelled':return <FileText className="w-4 h-4 text-muted-foreground" />;
    case 'draft':
    default:         return <FileText className="w-4 h-4 text-muted-foreground" />;
  }
};

// Badge only supports: "default" | "destructive" | "secondary" | "outline"
const getStatusVariant = (status: InvoiceRow['status']): 'default' | 'destructive' | 'secondary' | 'outline' => {
  switch (status) {
    case 'paid':     return 'default';
    case 'overdue':  return 'destructive';
    case 'sent':     return 'secondary';
    case 'cancelled':return 'outline';
    case 'draft':
    default:         return 'outline';
  }
};

// Optional extra coloring via className (keeps variants valid)
const getStatusBadgeClass = (status: InvoiceRow['status']) => {
  switch (status) {
    case 'paid':     return 'bg-green-100 text-green-700 border-green-200';
    case 'overdue':  return ''; // destructive already red via variant
    case 'sent':     return 'bg-blue-100 text-blue-800 border-blue-200';
    case 'cancelled':return 'bg-gray-100 text-gray-700 border-gray-200';
    case 'draft':
    default:         return '';
  }
};

type ConfirmKind = 'delete-one' | 'bulk-delete' | 'undo';

export default function PaymentTracker() {
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<InvoiceRow[]>([]);
  const [sumPaid, setSumPaid] = useState<Record<string, number>>({});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // record payment dialog
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [dialogInvoice, setDialogInvoice] = useState<InvoiceRow | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethodType>('cash');
  const [paymentNotes, setPaymentNotes] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);

  // themed confirm dialog
  const [confirm, setConfirm] = useState<{
    open: boolean;
    kind: ConfirmKind | null;
    invoice?: InvoiceRow;
  }>({ open: false, kind: null });

  const openConfirm = (kind: ConfirmKind, invoice?: InvoiceRow) =>
    setConfirm({ open: true, kind, invoice });
  const closeConfirm = () => setConfirm({ open: false, kind: null, invoice: undefined });

  const theme = useMemo(getTheme, []);

  // ===== Logo (live) =====
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

  const loadInvoices = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('invoices')
        .select('id, invoice_number, student_id, total_amount, status, due_date, students(student_name)')
        .order('invoice_date', { ascending: false });
      if (error) throw error;

      const rows: InvoiceRow[] = (data ?? []).map((inv: any) => ({
        id: inv.id,
        invoice_number: inv.invoice_number,
        student_id: inv.student_id,
        student_name: inv.students?.student_name ?? 'Unknown',
        total_amount: Number(inv.total_amount) || 0,
        status: inv.status as InvoiceRow['status'],
        due_date: inv.due_date,
      }));
      setInvoices(rows);

      // Load paid sums for visible invoices
      const ids = rows.map(r => r.id);
      if (ids.length) {
        const { data: pays, error: pErr } = await supabase
          .from('payments')
          .select('invoice_id, amount')
          .in('invoice_id', ids);
        if (pErr) throw pErr;
        const map: Record<string, number> = {};
        (pays ?? []).forEach(p => {
          map[p.invoice_id] = (map[p.invoice_id] || 0) + Number(p.amount || 0);
        });
        setSumPaid(map);
      } else {
        setSumPaid({});
      }
    } catch (e) {
      toast({
        title: 'Error loading invoices',
        description: e instanceof Error ? e.message : 'Failed to load invoices',
        variant: 'destructive',
      });
    } finally { setLoading(false); }
  };

  useEffect(() => { loadInvoices(); }, []);

  const remainingDue = (inv: InvoiceRow) => Math.max(0, inv.total_amount - (sumPaid[inv.id] || 0));

  const openPaymentDialog = (inv: InvoiceRow) => {
    setDialogInvoice(inv);
    setPaymentAmount(String(remainingDue(inv) || inv.total_amount));
    setPaymentMethod('cash');
    setPaymentNotes('');
    setIsDialogOpen(true);
  };

  const processPayment = async () => {
    if (!dialogInvoice) return;
    setIsProcessing(true);
    try {
      const amount = parseFloat(paymentAmount);
      if (!isFinite(amount) || amount <= 0) throw new Error('Invalid payment amount');

      // Generate required payment_reference (RPC + fallback)
      let payment_reference: string | undefined;
      try {
        const { data: ref, error: refErr } = await supabase.rpc('generate_payment_reference');
        if (!refErr && ref) payment_reference = String(ref);
      } catch { /* ignore */ }
      if (!payment_reference) {
        const y = new Date().getFullYear();
        const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
        payment_reference = `PAY-${y}-${rand}`;
      }

      // Insert payment
      const { error: payErr } = await supabase.from('payments').insert({
        invoice_id: dialogInvoice.id,
        student_id: dialogInvoice.student_id,
        amount,
        payment_method: paymentMethod,
        payment_reference,
        notes: paymentNotes || null,
      });
      if (payErr) throw payErr;

      // Update invoice status: paid if fully covered, otherwise keep or bump to 'sent'
      const newPaid = (sumPaid[dialogInvoice.id] || 0) + amount;
      const newStatus: InvoiceRow['status'] =
        newPaid >= dialogInvoice.total_amount ? 'paid' : (dialogInvoice.status === 'draft' ? 'sent' : dialogInvoice.status);
      const { error: invErr } = await supabase
        .from('invoices')
        .update({ status: newStatus })
        .eq('id', dialogInvoice.id);
      if (invErr) throw invErr;

      toast({ title: 'Payment recorded' });
      setIsDialogOpen(false);
      await loadInvoices();
    } catch (e) {
      toast({
        title: 'Payment failed',
        description: e instanceof Error ? e.message : 'Could not record payment',
        variant: 'destructive',
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // --- Confirmed actions (no UI confirm inside) ---
  const doUndoLastPayment = async (inv: InvoiceRow) => {
    setIsProcessing(true);
    try {
      const { data: last, error } = await supabase
        .from('payments')
        .select('id, amount')
        .eq('invoice_id', inv.id)
        .order('payment_date', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      if (!last) throw new Error('No payments found for this invoice');

      const { error: delErr } = await supabase.from('payments').delete().eq('id', last.id);
      if (delErr) throw delErr;

      const paidAfter = (sumPaid[inv.id] || 0) - Number(last.amount || 0);
      const newStatus: InvoiceRow['status'] =
        paidAfter <= 0 ? (inv.status === 'paid' ? 'sent' : inv.status)
                       : (paidAfter >= inv.total_amount ? 'paid' : 'sent');
      const { error: invErr } = await supabase.from('invoices').update({ status: newStatus }).eq('id', inv.id);
      if (invErr) throw invErr;

      toast({ title: 'Last payment undone' });
      await loadInvoices();
    } catch (e) {
      toast({
        title: 'Undo failed',
        description: e instanceof Error ? e.message : 'Could not undo payment',
        variant: 'destructive',
      });
    } finally { setIsProcessing(false); }
  };

  const doDeleteInvoice = async (inv: InvoiceRow) => {
    setIsProcessing(true);
    try {
      const { error } = await supabase.from('invoices').delete().eq('id', inv.id);
      if (error) throw error;
      setInvoices(prev => prev.filter(i => i.id !== inv.id));
      const { [inv.id]: _, ...rest } = sumPaid; setSumPaid(rest);
      toast({ title: 'Invoice deleted', description: inv.invoice_number });
    } catch (e) {
      toast({
        title: 'Delete failed',
        description: e instanceof Error ? e.message : 'Could not delete invoice',
        variant: 'destructive',
      });
    } finally { setIsProcessing(false); }
  };

  const doBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    setIsProcessing(true);
    try {
      const ids = Array.from(selectedIds);
      const { error } = await supabase.from('invoices').delete().in('id', ids);
      if (error) throw error;
      setInvoices(prev => prev.filter(i => !selectedIds.has(i.id)));
      const updated: Record<string, number> = { ...sumPaid };
      ids.forEach(id => { delete updated[id]; });
      setSumPaid(updated);
      setSelectedIds(new Set());
      toast({ title: 'Invoices deleted', description: `${ids.length} removed` });
    } catch (e) {
      toast({
        title: 'Bulk delete failed',
        description: e instanceof Error ? e.message : 'Could not delete selected invoices',
        variant: 'destructive',
      });
    } finally { setIsProcessing(false); }
  };

  // --- UI triggers that open themed confirm ---
  const undoLastPayment = (inv: InvoiceRow) => openConfirm('undo', inv);
  const deleteInvoice = (inv: InvoiceRow) => openConfirm('delete-one', inv);
  const bulkDelete = () => openConfirm('bulk-delete');

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allSelected = invoices.length > 0 && selectedIds.size === invoices.length;
  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(invoices.map(i => i.id)));
  };

  const currency = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '0.00');

  // --- Themed print: reuse app CSS links + theme variables + logo ---
  const printReceipt = async (inv: InvoiceRow) => {
    try {
      // teacher profile
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      const { data: prof } = await supabase.from('profiles')
        .select('full_name, school_name, email')
        .eq('user_id', uid)
        .single();

      // line items + payments
      const [{ data: items }, { data: pays }] = await Promise.all([
        supabase.from('invoice_line_items')
          .select('description, quantity, unit_price, total_price')
          .eq('invoice_id', inv.id)
          .order('created_at'),
        supabase.from('payments')
          .select('amount, payment_date, payment_method')
          .eq('invoice_id', inv.id)
          .order('payment_date'),
      ]);

      const paid = sumPaid[inv.id] || 0;
      const due = Math.max(0, inv.total_amount - paid);
      const palette = getTheme();

      // 1) Pull in the app’s actual CSS (Tailwind/shadcn + your globals)
      const cssLinks = Array.from(
        document.querySelectorAll('link[rel="stylesheet"], style')
      ).map(el => (el as HTMLElement).outerHTML).join('\n');

      // 2) Theme variables so colors match Settings
      const themeCss =
        `:root{--p:${palette.primary};--s:${palette.secondary};--a:${palette.accent};--bg:${palette.bg};--ln:${palette.line}}`;

      // 3) Build HTML
      const html = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>Receipt ${inv.invoice_number}</title>
${cssLinks}
<style>
${themeCss}
/* Minimal extras for print */
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:#111}
.wrap{max-width:900px;margin:0 auto;padding:32px}
.brand{background:var(--p);color:white;padding:16px 20px;border-radius:12px}
.brand-row{display:flex;align-items:center;justify-content:space-between;gap:16px}
.brand-left{display:flex;align-items:center;gap:12px}
.logo-circle{width:40px;height:40px;border-radius:9999px;background:rgba(255,255,255,0.12);display:flex;align-items:center;justify-content:center;overflow:hidden}
.logo-circle img{max-width:36px;max-height:36px;object-fit:contain;display:block}
.brand .title{font-size:22px;font-weight:800;letter-spacing:.02em;line-height:1.2}
.brand .subtitle{opacity:.95;font-size:12px}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px}
.box{border:1px solid var(--ln);border-radius:10px;padding:12px 14px;background:white}
.muted{color:var(--s)}
table{width:100%;border-collapse:collapse;margin-top:10px;background:white;border:1px solid var(--ln);border-radius:10px;overflow:hidden}
thead th{background:rgba(0,0,0,0.035);color:#111;text-align:right;padding:10px;border-bottom:1px solid var(--ln)}
thead th:first-child, tbody td:first-child{text-align:left}
tbody td{padding:12px;border-bottom:1px solid var(--ln);text-align:right}
tfoot td{padding:8px 12px;text-align:right}
.total{font-weight:800;border-top:2px solid var(--ln)}
.pill{display:inline-block;background:var(--a);color:#111;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600}
.footer{margin-top:24px;font-size:12px;color:var(--s)}
@media print{
  .noprint{display:none !important}
  *{-webkit-print-color-adjust: exact; print-color-adjust: exact;}
  @page{margin:12mm}
}
</style>
</head>
<body>
  <div class="wrap">
    <div class="brand">
      <div class="brand-row">
        <div class="brand-left">
          <div class="logo-circle">
            ${
              logoUrl
                ? `<img src="${logoUrl}" alt="Logo" />`
                : `<span style="font-size:10px;font-weight:800;opacity:.9">LOGO</span>`
            }
          </div>
          <div>
            <div class="title">RECEIPT • ${inv.invoice_number}</div>
            <div class="subtitle">${new Date().toLocaleString()}</div>
          </div>
        </div>
      </div>
    </div>

    <div class="meta">
      <div class="box">
        <div style="font-weight:700;margin-bottom:6px">Paid By</div>
        <div>${inv.student_name}</div>
        <div class="muted">Invoice due ${new Date(inv.due_date).toLocaleDateString()}</div>
      </div>
      <div class="box">
        <div style="font-weight:700;margin-bottom:6px">Issuer</div>
        <div>${(prof?.school_name || prof?.full_name || 'Your Name')}</div>
        ${prof?.email ? `<div class="muted">${prof.email}</div>` : ''}
      </div>
    </div>

    <table style="margin-top:18px">
      <thead><tr><th>Description</th><th>Qty</th><th>Unit</th><th>Total</th></tr></thead>
      <tbody>
        ${(items ?? []).map(it => `
          <tr>
            <td>${it.description}</td>
            <td>${Number(it.quantity||0)}</td>
            <td>$${Number(it.unit_price||0).toFixed(2)}</td>
            <td>$${Number(it.total_price||0).toFixed(2)}</td>
          </tr>
        `).join('')}
      </tbody>
      <tfoot>
        <tr><td colspan="3">Subtotal</td><td>$${Number(inv.total_amount).toFixed(2)}</td></tr>
        <tr><td colspan="3">Paid</td><td>$${paid.toFixed(2)}</td></tr>
        <tr class="total"><td colspan="3">Amount Due</td><td class="pill">$${due.toFixed(2)}</td></tr>
      </tfoot>
    </table>

    ${(pays ?? []).length ? `
      <div class="box" style="margin-top:14px">
        <div style="font-weight:700;margin-bottom:6px">Payments</div>
        ${(pays ?? []).map(p => `<div style="display:flex;justify-content:space-between"><div class="muted">${new Date(p.payment_date).toLocaleDateString()} • ${p.payment_method}</div><div>$${Number(p.amount||0).toFixed(2)}</div></div>`).join('')}
      </div>
    ` : ''}

    <div class="footer">Thank you! This receipt was generated by Class Attendance Manager.</div>

    <div class="noprint" style="margin-top:16px">
      <button onclick="window.print()" style="padding:10px 14px;border-radius:8px;border:1px solid var(--ln);background: var(--p); color:white;font-weight:700">Print</button>
    </div>
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
      idoc.open(); idoc.write(html); idoc.close();

      const cleanup = () => setTimeout(() => { try { document.body.removeChild(iframe); } catch {} }, 0);
      iframe.contentWindow?.addEventListener('afterprint', cleanup);
      setTimeout(cleanup, 30000);

      iframe.contentWindow?.focus();
      iframe.contentWindow?.print();
    } catch (e) {
      toast({ title: 'Print failed', description: e instanceof Error ? e.message : 'Could not open receipt', variant: 'destructive' });
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Track Payments</CardTitle>
              <CardDescription>View invoices, record / undo payments, print receipts, or delete (single / bulk).</CardDescription>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm flex items-center gap-2 select-none">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} /> Select all
              </label>
              {selectedIds.size > 0 && (
                <Button variant="destructive" size="sm" onClick={bulkDelete} disabled={isProcessing}>
                  <Trash2 className="w-4 h-4 mr-1" /> Delete Selected ({selectedIds.size})
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : invoices.length === 0 ? (
            <div className="rounded border p-6 text-sm text-muted-foreground">No invoices yet.</div>
          ) : (
            <div className="space-y-3">
              {invoices.map(inv => {
                const paid = sumPaid[inv.id] || 0;
                const due = Math.max(0, inv.total_amount - paid);
                return (
                  <div key={inv.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <input type="checkbox" checked={selectedIds.has(inv.id)} onChange={() => toggleSelect(inv.id)} />
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          {getStatusIcon(inv.status)}
                          <span className="font-medium">{inv.invoice_number}</span>
                          <Badge
                            variant={getStatusVariant(inv.status)}
                            className={getStatusBadgeClass(inv.status)}
                          >
                            {inv.status}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">
                          {inv.student_name} • ${currency(inv.total_amount)} • Paid ${currency(paid)} • Due ${currency(due)} • Due date {new Date(inv.due_date).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      {inv.status !== 'paid' && (
                        <Button size="sm" variant="outline" onClick={() => openPaymentDialog(inv)}>
                          <DollarSign className="w-4 h-4 mr-1" /> Record Payment
                        </Button>
                      )}
                      {paid > 0 && (
                        <Button size="sm" variant="outline" onClick={() => undoLastPayment(inv)} disabled={isProcessing} title="Undo last payment">
                          <RotateCcw className="w-4 h-4 mr-1" /> Undo Last
                        </Button>
                      )}
                      <Button size="sm" variant="outline" onClick={() => printReceipt(inv)}>
                        <Receipt className="w-4 h-4 mr-1" /> Receipt
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => deleteInvoice(inv)} disabled={isProcessing}>
                        <Trash2 className="w-4 h-4 mr-1" /> Delete
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Record Payment Dialog */}
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>
              {dialogInvoice ? <>Invoice <span className="font-medium">{dialogInvoice.invoice_number}</span> for {dialogInvoice.student_name}</> : '—'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Payment Amount</Label>
              <Input type="number" step="0.01" value={paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Payment Method</Label>
              <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as PaymentMethodType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="cash">Cash</SelectItem>
                  <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                  <SelectItem value="card">Card</SelectItem>
                  <SelectItem value="cheque">Cheque</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Notes (Optional)</Label>
              <Input placeholder="Payment notes..." value={paymentNotes} onChange={(e) => setPaymentNotes(e.target.value)} />
            </div>
            <Button onClick={processPayment} disabled={isProcessing} className="w-full">
              {isProcessing ? 'Processing…' : 'Record Payment'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Themed Confirm Dialog (Undo / Delete one / Bulk delete) */}
      <AlertDialog open={confirm.open} onOpenChange={(o) => { if (!o) closeConfirm(); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirm.kind === 'undo' && 'Undo last payment?'}
              {confirm.kind === 'delete-one' && 'Delete this invoice?'}
              {confirm.kind === 'bulk-delete' && 'Delete selected invoices?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirm.kind === 'undo' && `This will remove the most recent payment from ${confirm.invoice?.invoice_number}.`}
              {confirm.kind === 'delete-one' && `This will permanently remove ${confirm.invoice?.invoice_number}, its line items, and any payments.`}
              {confirm.kind === 'bulk-delete' && `This will permanently remove ${selectedIds.size} invoice(s), including their items and payments.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={closeConfirm}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                try {
                  if (confirm.kind === 'undo' && confirm.invoice) await doUndoLastPayment(confirm.invoice);
                  if (confirm.kind === 'delete-one' && confirm.invoice) await doDeleteInvoice(confirm.invoice);
                  if (confirm.kind === 'bulk-delete') await doBulkDelete();
                } finally {
                  closeConfirm();
                }
              }}
            >
              {confirm.kind === 'undo' && 'Undo'}
              {confirm.kind === 'delete-one' && 'Delete'}
              {confirm.kind === 'bulk-delete' && 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
