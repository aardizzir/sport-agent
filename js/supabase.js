export const SUPABASE_URL = 'https://thmauqyngmlmgrfnldxj.supabase.co';
export const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRobWF1cXluZ21sbWdyZm5sZHhqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgwMjE5NzIsImV4cCI6MjA5MzU5Nzk3Mn0._ZwZORe4POzoi6hX9NBxgHnXlK8L7KxmnaWAnk2HpxI';
export const WORKER_URL = 'https://sport-agent-api.a-ardizzir.workers.dev';

export const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
