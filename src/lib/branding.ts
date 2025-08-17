import { supabase } from '@/integrations/supabase/client';

// keys/events
const KEY = 'branding_logo_url';
const EVENT = 'branding:logo';
const BUCKET = 'branding';

// heartbeat so other tabs/components can react (logo changes)
const LAST_UPDATED_KEY = 'branding:lastUpdated';
const ping = () => {
  try {
    localStorage.setItem(LAST_UPDATED_KEY, String(Date.now()));
  } catch {}
};

// ----- Logo utils -----
export const getLogoUrl = (): string | null => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};

export const setLogoUrl = (url: string | null) => {
  try {
    if (url) localStorage.setItem(KEY, url);
    else localStorage.removeItem(KEY);
    window.dispatchEvent(new CustomEvent(EVENT, { detail: url }));
    ping();
  } catch {}
};

export const onLogoUrlChange = (cb: (url: string | null) => void) => {
  const storageHandler = (e: StorageEvent) => {
    if (e.key === KEY || e.key === LAST_UPDATED_KEY) cb(getLogoUrl());
  };
  const customHandler = (e: Event) => cb((e as CustomEvent<string | null>).detail ?? null);

  window.addEventListener('storage', storageHandler);
  window.addEventListener(EVENT, customHandler);

  return () => {
    window.removeEventListener('storage', storageHandler);
    window.removeEventListener(EVENT, customHandler);
  };
};

export const hydrateLogoFromStorage = async () => {
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return;

    const { data: files } = await supabase.storage.from(BUCKET).list(uid, {
      limit: 50,
      sortBy: { column: 'updated_at', order: 'desc' },
    });
    if (!files?.length) return;

    const latest = [...files]
      .filter((f) => f.name.startsWith('logo-'))
      .sort(
        (a, b) =>
          new Date(b.updated_at || b.created_at || 0).getTime() -
          new Date(a.updated_at || a.created_at || 0).getTime()
      )[0];
    if (!latest) return;

    const path = `${uid}/${latest.name}`;
    const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
    if (pub?.publicUrl) setLogoUrl(pub.publicUrl);
  } catch {}
};

export const uploadLogoFile = async (file: File): Promise<string> => {
  const okTypes = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'];
  if (!okTypes.includes(file.type)) throw new Error('Use PNG, JPG, SVG, or WEBP.');
  if (file.size > 1024 * 1024) throw new Error('Please keep the logo under 1MB.');

  const { data: auth } = await supabase.auth.getUser();
  const uid = auth.user?.id;
  if (!uid) throw new Error('Not authenticated');

  const ext = (file.name.split('.').pop() || 'png').toLowerCase();
  const path = `${uid}/logo-${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) throw upErr;

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const publicUrl = pub?.publicUrl;
  if (!publicUrl) throw new Error('Could not generate public URL');

  setLogoUrl(publicUrl);

  // cleanup older logo files (keep newest)
  try {
    const { data: files } = await supabase.storage.from(BUCKET).list(uid, {
      limit: 100,
      sortBy: { column: 'updated_at', order: 'desc' },
    });
    if (files && files.length > 1) {
      const others = files.filter((f) => f.name.startsWith('logo-')).slice(1);
      const toDelete = others.map((f) => `${uid}/${f.name}`);
      if (toDelete.length) await supabase.storage.from(BUCKET).remove(toDelete);
    }
  } catch {}
  return publicUrl;
};

export const removeLogo = async () => {
  setLogoUrl(null);
  try {
    const { data: auth } = await supabase.auth.getUser();
    const uid = auth.user?.id;
    if (!uid) return;
    const { data: files } = await supabase.storage.from(BUCKET).list(uid, { limit: 100 });
    if (files?.length) {
      const paths = files.filter((f) => f.name.startsWith('logo-')).map((f) => `${uid}/${f.name}`);
      if (paths.length) await supabase.storage.from(BUCKET).remove(paths);
    }
  } catch {}
};
