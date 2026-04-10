import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_PUBLISHABLE_KEY =
  import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY || '';

let realtimeClient = null;

function getRealtimeClient() {
  if (!SUPABASE_URL || !SUPABASE_PUBLISHABLE_KEY) return null;
  if (!realtimeClient) {
    realtimeClient = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }
  return realtimeClient;
}

export function subscribeToTasksWorkspaceChanges(onChange) {
  const client = getRealtimeClient();
  if (!client) return () => {};

  const channel = client
    .channel('efort-tasks-workspace')
    .on('broadcast', { event: 'workspace_changed' }, (payload) => {
      onChange?.(payload);
    })
    .subscribe();

  return () => {
    client.removeChannel(channel);
  };
}
