// RLS test: runs as anonymous and as two signed-in users and checks every blocked action is blocked.
// Needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY in .env. Run against a
// dev/staging project: it creates and deletes throwaway users and items.
//
//   npm run rls-test

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY!;
const serviceKey = process.env.SUPABASE_SECRET_KEY!;
if (!url || !anonKey || !serviceKey) throw new Error("Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY in .env");

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
const anon = () => createClient(url, anonKey, { auth: { persistSession: false } });

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${JSON.stringify(detail)}`}`);
}

const stamp = Date.now();
const password = `Tmp-${stamp}-pw!`;

// Registration only accepts UTA addresses, so the throwaway users use one too (no mail is sent).
async function makeUser(label: string) {
  const email = `rls-${label}-${stamp}@mavs.uta.edu`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = anon();
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) throw signInErr;
  return { id: data.user.id, client };
}

const statusOf = async (itemId: string) =>
  (await admin.from("items").select("status").eq("id", itemId).single()).data?.status;

async function main() {
  const alice = await makeUser("alice");
  const bob = await makeUser("bob");
  const guest = anon();
  const createdUsers = [alice.id, bob.id];

  // Fixtures via service role.
  const { data: item } = await admin.from("items")
    .insert({ name: "RLS Test Beans", categories: ["canned_jarred"], status: "in_stock", created_by: alice.id })
    .select().single().throwOnError();
  const itemId = item!.id as string;
  const jobId = crypto.randomUUID();
  await admin.from("intake_jobs")
    .insert({ id: jobId, batch_id: crypto.randomUUID(), photo_path: `${alice.id}/x/${jobId}.jpg`, created_by: alice.id })
    .throwOnError();

  try {
    // ----- anonymous -----
    const aItems = await guest.from("items").select("id");
    check("anon cannot read items", (aItems.data ?? []).length === 0, aItems);
    const aJobs = await guest.from("intake_jobs").select("id");
    check("anon cannot read intake_jobs", (aJobs.data ?? []).length === 0, aJobs);
    const aUsage = await guest.from("api_usage").select("model");
    check("anon cannot read api_usage", (aUsage.data ?? []).length === 0, aUsage);
    const aView = await guest.from("available_items").select("*").eq("id", itemId);
    check("anon can read available_items", aView.data?.length === 1 && aView.data[0].availability === "in_stock", aView);
    const aCats = await guest.from("categories").select("slug");
    check("anon can read categories", (aCats.data ?? []).length === 18, aCats);
    const aInsert = await guest.from("items").insert({ name: "x", categories: ["other"] });
    check("anon cannot insert items", !!aInsert.error, aInsert);
    const aStatus = await guest.rpc("set_item_status", { p_item_id: itemId, p_status: "out" });
    check("anon cannot set status", !!aStatus.error && (await statusOf(itemId)) === "in_stock", aStatus);
    const aResolve = await guest.rpc("resolve_job_existing", { p_job_id: jobId, p_item_id: itemId });
    check("anon cannot resolve a job", !!aResolve.error, aResolve);

    // ----- signed-in user -----
    const uItems = await alice.client.from("items").select("id").eq("id", itemId);
    check("user can read items", uItems.data?.length === 1, uItems);
    const uInsert = await alice.client.from("items").insert({ name: "Direct Item", categories: ["snacks"], created_by: alice.id });
    check("user cannot insert items directly", !!uInsert.error, uInsert);
    const uUpdate = await alice.client.from("items").update({ name: "Renamed" }).eq("id", itemId).select();
    check("user cannot edit items directly", !uUpdate.data?.length, uUpdate);
    const uStatusWrite = await alice.client.from("items").update({ status: "out" }).eq("id", itemId).select();
    check("user cannot set status by writing the table", !uStatusWrite.data?.length && (await statusOf(itemId)) === "in_stock", uStatusWrite);
    const uDelete = await alice.client.from("items").delete().eq("id", itemId).select();
    check("user cannot delete items", !uDelete.data?.length, uDelete);
    const uLog = await alice.client.from("item_status_log").select("id");
    check("user cannot read the status log table", (uLog.data ?? []).length === 0, uLog);
    const uUsage = await alice.client.from("api_usage").select("model");
    check("user cannot read api_usage", (uUsage.data ?? []).length === 0, uUsage);

    const uBad = await alice.client.rpc("set_item_status", { p_item_id: itemId, p_status: "plenty" });
    check("set_item_status rejects an unknown status", !!uBad.error, uBad);
    const uLow = await alice.client.rpc("set_item_status", { p_item_id: itemId, p_status: "low" });
    check("user can set status", !uLow.error && (await statusOf(itemId)) === "low", uLow);
    const uOut = await alice.client.rpc("set_item_status", { p_item_id: itemId, p_status: "out" });
    check("user can mark an item out of stock", !uOut.error && (await statusOf(itemId)) === "out", uOut);
    const uApply = await alice.client.rpc("apply_item_status", { p_item_id: itemId, p_status: "in_stock", p_user: alice.id });
    check("apply_item_status is not callable by users", !!uApply.error && (await statusOf(itemId)) === "out", uApply);

    // ----- jobs belong to their creator -----
    const newJob = { id: crypto.randomUUID(), batch_id: crypto.randomUUID(), photo_path: "x", created_by: alice.id };
    const spoof = await bob.client.from("intake_jobs").insert(newJob);
    check("user cannot create a job for someone else", !!spoof.error, spoof);
    const preset = await alice.client.from("intake_jobs").insert({ ...newJob, status: "green" });
    check("user cannot create a job that is already resolved", !!preset.error, preset);
    const own = await alice.client.from("intake_jobs").insert({ ...newJob, availability: "low" });
    check("user can create their own job", !own.error, own);
    await admin.from("intake_jobs").delete().eq("id", newJob.id);

    const bobSees = await bob.client.from("intake_jobs").select("id").eq("id", jobId);
    check("user cannot read another user's job", (bobSees.data ?? []).length === 0, bobSees);
    const aliceSees = await alice.client.from("intake_jobs").select("id").eq("id", jobId);
    check("user can read their own job", aliceSees.data?.length === 1, aliceSees);
    const jUpdate = await alice.client.from("intake_jobs").update({ status: "green" }).eq("id", jobId).select();
    check("user cannot edit a job directly", !jUpdate.data?.length, jUpdate);
    const bobResolve = await bob.client.rpc("resolve_job_existing", { p_job_id: jobId, p_item_id: itemId });
    check("user cannot resolve another user's job", !!bobResolve.error, bobResolve);

    // ----- resolving a job updates the item's status -----
    await admin.from("intake_jobs").update({ availability: "in_stock" }).eq("id", jobId).throwOnError();
    const resolve = await alice.client.rpc("resolve_job_existing", { p_job_id: jobId, p_item_id: itemId });
    check("resolving a job onto an existing item updates its status", !resolve.error && (await statusOf(itemId)) === "in_stock", resolve);
    const count = async () => (await admin.from("items").select("id", { count: "exact", head: true })).count;
    const before = await count();
    const again = await alice.client.rpc("resolve_job_existing", { p_job_id: jobId, p_item_id: itemId });
    check("resolving twice is harmless and adds no item", !again.error && (await count()) === before, again);

    // ----- unified wishlist and availability notifications -----
    const anonymousSave = await guest.from('watchlist_items').insert({user_id:alice.id,item_id:itemId})
    check('anon cannot add a wishlist item',!!anonymousSave.error,anonymousSave)
    const saved = await alice.client.from('watchlist_items').insert({user_id:alice.id,item_id:itemId})
    check('user can add to wishlist',!saved.error,saved)
    const other = await bob.client.from('watchlist_items').insert({user_id:bob.id,item_id:itemId})
    check('accounts have independent wishlists',!other.error,other)
    const wishlistSpoof = await bob.client.from('watchlist_items').insert({user_id:alice.id,item_id:crypto.randomUUID()})
    check('user cannot add to another wishlist',!!wishlistSpoof.error,wishlistSpoof)
    const rows = await bob.client.from('watchlist_items').select('user_id')
    check('user sees only their wishlist',rows.data?.length===1&&rows.data[0].user_id===bob.id,rows)
    await admin.from('items').update({status:'out'}).eq('id',itemId).throwOnError()
    await alice.client.rpc('set_wishlist_item',{p_item_id:itemId,p_enabled:true}).throwOnError()
    await bob.client.rpc('set_wishlist_item',{p_item_id:itemId,p_enabled:true}).throwOnError()
    await admin.from('items').update({status:'in_stock'}).eq('id',itemId).throwOnError()
    const queued = await admin.from('notification_queue').select('user_id,status').eq('item_id',itemId).eq('type','wishlist_available').is('sent_at',null)
    check('availability queues both wishlist accounts',queued.data?.length===2,queued)
    const privateQueue = await alice.client.from('notification_queue').select('id')
    check('user cannot read notification queue',!privateQueue.data?.length,privateQueue)
    const claim = await alice.client.rpc('claim_notifications',{p_users:10})
    check('users cannot run sender claims',!!claim.error,claim)
    const pause = await alice.client.rpc('set_wishlist_email_enabled',{p_enabled:false})
    const settings = await alice.client.rpc('get_wishlist_email_settings')
    check('user can pause their emails',!pause.error&&settings.data?.enabled===false,settings)
    const kept = await alice.client.from('watchlist_items').select('item_id')
    check('pausing email preserves wishlist',kept.data?.length===1,kept)
    const crossDelete = await bob.client.from('watchlist_items').delete().eq('user_id',alice.id).select()
    check('user cannot delete another wishlist',!crossDelete.data?.length,crossDelete)
  } finally {
    await admin.from("intake_jobs").delete().eq("id", jobId);
    await admin.from("items").delete().eq("id", itemId);
    for (const id of createdUsers) await admin.auth.admin.deleteUser(id);
  }

  console.log(failures === 0 ? "\nAll RLS checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
