import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL?.trim();
const SUPABASE_PUBLISHABLE_KEY =
  process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

const isLikelyPlaceholder = (value: string | undefined): boolean => {
  if (!value) {
    return true;
  }

  const normalized = value.toLowerCase();
  return (
    normalized.includes('your-') ||
    normalized.includes('example') ||
    normalized.includes('localhost') ||
    normalized.includes('placeholder') ||
    normalized.includes('changeme') ||
    normalized.includes('xxxx') ||
    normalized.includes('<') ||
    normalized.includes('replace')
  );
};

const isValidSupabaseUrl = (value: string | undefined): value is string => {
  if (!value || isLikelyPlaceholder(value)) {
    return false;
  }

  try {
    const parsed = new URL(value);
    return parsed.protocol === 'https:' && parsed.hostname.includes('supabase.co');
  } catch {
    return false;
  }
};

const isValidAnonOrAdminKey = (value: string | undefined): value is string => {
  if (!value || isLikelyPlaceholder(value)) {
    return false;
  }

  return value.startsWith('ey') || value.startsWith('sb_') || value.length >= 20;
};

export const supabaseConfig = {
  url: SUPABASE_URL ?? null,
  publishableKey: SUPABASE_PUBLISHABLE_KEY ?? null,
  serviceRoleKey: SUPABASE_SERVICE_ROLE_KEY ?? null,
  get isValid() {
    return isValidSupabaseUrl(SUPABASE_URL) && isValidAnonOrAdminKey(SUPABASE_PUBLISHABLE_KEY);
  },
  errorMessage: (() => {
    if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) {
      return 'SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY is missing from environment variables.';
    }

    if (!isValidSupabaseUrl(SUPABASE_URL)) {
      return `Invalid SUPABASE_URL. '${SUPABASE_URL}' is not a valid Supabase URL.`;
    }

    if (!isValidAnonOrAdminKey(SUPABASE_PUBLISHABLE_KEY)) {
      return 'Invalid SUPABASE_PUBLISHABLE_KEY. Check .env values are not placeholders.';
    }

    return null;
  })(),
};

export const getSupabaseClient = (): SupabaseClient => {
  if (!supabaseConfig.isValid || !supabase) {
    throw new Error(`Forum backend is unavailable: ${supabaseConfig.errorMessage}`);
  }

  const client = supabaseAdmin ?? supabase;
  if (!client) {
    throw new Error(`Forum backend is unavailable: ${supabaseConfig.errorMessage}`);
  }

  return client;
};

interface AuthorIdentity {
  id: string;
  name: string;
  avatar: string;
}

let authInitPromise: Promise<void> | null = null;

const createSupabaseClient = (key: string): SupabaseClient =>
  createClient(SUPABASE_URL as string, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

export const supabase = supabaseConfig.isValid
  ? createSupabaseClient(SUPABASE_PUBLISHABLE_KEY as string)
  : null;

export const supabaseAdmin =
  supabaseConfig.isValid && isValidAnonOrAdminKey(SUPABASE_SERVICE_ROLE_KEY)
    ? createSupabaseClient(SUPABASE_SERVICE_ROLE_KEY)
    : null;

const getAuthOnlyClient = (): SupabaseClient => {
  if (!supabaseConfig.isValid || !supabase) {
    throw new Error(`Forum backend is unavailable: ${supabaseConfig.errorMessage}`);
  }

  return supabase;
};

const initializeAuthenticatedSession = async (): Promise<void> => {
  const authClient = getAuthOnlyClient();
  const { data: existingSession, error: getSessionError } = await authClient.auth.getSession();

  if (getSessionError) {
    throw getSessionError;
  }

  if (existingSession.session?.user) {
    return;
  }

  const { error: signInError } = await authClient.auth.signInAnonymously();

  if (signInError) {
    throw signInError;
  }
};

export const ensureAuthenticatedSession = async (): Promise<void> => {
  if (!supabaseConfig.isValid || !supabase) {
    throw new Error(`Forum backend is unavailable: ${supabaseConfig.errorMessage}`);
  }

  if (supabaseAdmin) {
    return;
  }

  if (!authInitPromise) {
    authInitPromise = initializeAuthenticatedSession().catch((error) => {
      authInitPromise = null;
      throw error;
    });
  }

  await authInitPromise;
};

const readStringMetaValue = (
  metadata: Record<string, unknown>,
  keys: ReadonlyArray<string>,
): string => {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === 'string' && value.trim() !== '') {
      return value;
    }
  }

  return '';
};

export const getServerAuthorIdentity = async (fallback: AuthorIdentity): Promise<AuthorIdentity> => {
  if (supabaseAdmin) {
    return fallback;
  }

  await ensureAuthenticatedSession();

  const authClient = getAuthOnlyClient();
  const { data: userData, error: getUserError } = await authClient.auth.getUser();

  if (getUserError) {
    throw getUserError;
  }

  const user = userData.user;
  if (!user) {
    throw new Error('Supabase session is not available');
  }

  const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
  const resolvedName =
    readStringMetaValue(metadata, ['name', 'full_name', 'user_name', 'nickname']) ||
    fallback.name;
  const resolvedAvatar = readStringMetaValue(metadata, ['avatar_url', 'avatar']) || fallback.avatar;

  return {
    id: user.id,
    name: resolvedName,
    avatar: resolvedAvatar,
  };
};
