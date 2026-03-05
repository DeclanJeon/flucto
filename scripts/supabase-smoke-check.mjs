import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

config();

const url = process.env.SUPABASE_URL?.trim();
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY?.trim() || process.env.SUPABASE_ANON_KEY?.trim();
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
const now = new Date().toISOString();

const isLikelyPlaceholder = (value) => {
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

const isValidSupabaseUrl = (value) => {
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

const isValidAnonOrAdminKey = (value) => {
  if (!value || isLikelyPlaceholder(value)) {
    return false;
  }

  return value.startsWith('ey') || value.startsWith('sb_') || value.length >= 20;
};

const createClientFor = (key) =>
  createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });

const ensureConfig = () => {
  if (!url || !publishableKey) {
    console.error('Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY');
    process.exit(1);
  }

  if (!isValidSupabaseUrl(url)) {
    console.error(`Invalid SUPABASE_URL. '${url}' is not a valid Supabase URL.`);
    process.exit(1);
  }

  if (!isValidAnonOrAdminKey(publishableKey)) {
    console.error('Invalid SUPABASE_PUBLISHABLE_KEY. Check .env values are not placeholders.');
    process.exit(1);
  }
};

const runSmoke = async () => {
  ensureConfig();

  const anonClient = createClientFor(publishableKey);
  const adminClient = serviceKey ? createClientFor(serviceKey) : null;

  const list = await anonClient.from('posts').select('id').limit(1);
  if (list.error) {
    console.error('posts-list failed:', list.error.message);
    process.exit(1);
  }

  const listAfterSmokeInsert = async () => {
    const result = await anonClient.from('posts').select('id,title,author,created_at').limit(20);
    if (result.error) {
      console.error('posts-list after operations failed:', result.error.message);
      process.exit(1);
    }
    console.log('posts-list check:', result.data?.length || 0);
  };

  const payload = {
    title: 'Smoke test title',
    content: 'Smoke test content',
    tags: ['smoke'],
    author: {
      id: 'smoke-tester',
      name: 'smoke tester',
      avatar: '',
    },
    created_at: now,
    updated_at: now,
  };

  const anonInsert = await anonClient
    .from('posts')
    .insert([payload])
    .select('id')
    .maybeSingle();

  if (anonInsert.error) {
    console.warn('anon insert result:', anonInsert.error.code, anonInsert.error.message);
  } else {
    console.log('anon insert success:', anonInsert.data?.id);
    if (anonInsert.data?.id) {
      await anonClient.from('posts').delete().eq('id', anonInsert.data.id);
    }
  }

  await listAfterSmokeInsert();

  if (!adminClient) {
    console.log('No SUPABASE_SERVICE_ROLE_KEY provided; skipping admin forum checks.');
    return;
  }

  const adminInsert = await adminClient
    .from('posts')
    .insert([payload])
    .select('id')
    .maybeSingle();

  if (adminInsert.error) {
    console.error('admin insert failed:', adminInsert.error.code, adminInsert.error.message);
    process.exit(1);
  }

  if (!adminInsert.data?.id) {
    console.error('admin insert failed: no post id returned');
    process.exit(1);
  }

  const postId = adminInsert.data.id;
  console.log('admin insert success:', postId);

  const postList = await adminClient.from('posts').select('id,title,created_at').order('created_at', { ascending: false });
  if (postList.error) {
    console.error('admin posts-list failed:', postList.error.message);
    process.exit(1);
  }

  const postGet = await adminClient.from('posts').select('*').eq('id', postId).maybeSingle();
  if (postGet.error || !postGet.data) {
    console.error('admin posts-get failed:', postGet.error?.message ?? 'missing post data');
    process.exit(1);
  }

  const updatedTitle = `Smoke test title (updated) ${Date.now()}`;
  const postUpdate = await adminClient
    .from('posts')
    .update({
      title: updatedTitle,
      updated_at: new Date().toISOString(),
    })
    .eq('id', postId)
    .select('title')
    .maybeSingle();

  if (postUpdate.error || !postUpdate.data || postUpdate.data.title !== updatedTitle) {
    console.error('admin posts-update failed:', postUpdate.error?.message ?? 'title mismatch');
    process.exit(1);
  }

  const postDelete = await adminClient.from('posts').delete().eq('id', postId);
  if (postDelete.error) {
    console.error('admin posts-delete failed:', postDelete.error.message);
    process.exit(1);
  }

  const verifyPostDeleted = await adminClient.from('posts').select('id').eq('id', postId);
  if (verifyPostDeleted.error) {
    console.error('verify posts-delete failed:', verifyPostDeleted.error.message);
    process.exit(1);
  }

  if ((verifyPostDeleted.data || []).length !== 0) {
    console.error('verify posts-delete failed: post still exists');
    process.exit(1);
  }

  console.log('admin forum CRUD checks: posts create/list/get/update/delete pass');
};

runSmoke()
  .then(() => {
    console.log('supabase smoke check passed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('smoke check failed:', error?.message ?? error);
    process.exit(1);
  });
