const SUPABASE_URL = "https://aaasylkzlmzrgqnqpncm.supabase.co";

const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFhYXN5bGt6bG16cmdxbnFwbmNtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ1NzU4NTcsImV4cCI6MjEwMDE1MTg1N30.MBhgdpu6y81AjdwH8ZXgOtM_2jnE4N85E47c9BWPmmQ";

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabaseClient = createClient(
    SUPABASE_URL,
    SUPABASE_ANON_KEY
);
