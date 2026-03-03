import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://pgwbjshakpjyrzxdjnvi.supabase.co';
const supabaseKey = 'sb_publishable_9HsqOt0qhhICLcXkmmZ8Gg_DGoOyGEy';

export const supabase = createClient(supabaseUrl, supabaseKey);
