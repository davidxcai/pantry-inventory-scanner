-- Calls /api/notify every 10 minutes (Vercel Hobby crons are daily only).
-- The URL and the cron secret live in Supabase Vault, not in this file. Before applying, run once
-- in the SQL editor (the secret is the same CRON_SECRET the Vercel project uses):
--
--   select vault.create_secret('https://utapantry.xyz/api/notify', 'notify_url');
--   select vault.create_secret('<CRON_SECRET>', 'cron_secret');

create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'send-stock-notifications',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'notify_url'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'cron_secret')
    ),
    timeout_milliseconds := 60000
  );
  $$
);
