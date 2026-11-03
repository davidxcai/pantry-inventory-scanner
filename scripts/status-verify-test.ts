// Status update test: single-student reports, the 10-minute cooldown and the 30-a-day 'out' cap.
// Needs SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY in .env and the
// 20261102070000_single_student_verification migration applied. Run against a dev/staging project: it
// creates and deletes throwaway @mavs.uta.edu users and items.
//
//   npm run status-test

import fs from "node:fs";
import { createClient } from "@supabase/supabase-js";

if (fs.existsSync(".env")) process.loadEnvFile(".env");

const url = process.env.SUPABASE_URL!;
const anonKey = process.env.SUPABASE_PUBLISHABLE_KEY!;
const serviceKey = process.env.SUPABASE_SECRET_KEY!;
if (!url || !anonKey || !serviceKey) throw new Error("Set SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY in .env");

const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> ${JSON.stringify(detail)}`}`);
}

const stamp = Date.now();
const password = `Tmp-${stamp}-pw!`;
const CAP = 30;

async function makeStudent(label: string) {
  const email = `status-${label}-${stamp}@mavs.uta.edu`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw error;
  const client = createClient(url, anonKey, { auth: { persistSession: false } });
  const { error: signInErr } = await client.auth.signInWithPassword({ email, password });
  if (signInErr) throw signInErr;
  return { id: data.user.id, client };
}
type Student = Awaited<ReturnType<typeof makeStudent>>;

const set = (s: Student, itemId: string, status: string) => s.client.rpc("set_item_status", { p_item_id: itemId, p_status: status });
const stateOf = async (itemId: string) => {
  const { data } = await admin.from("items").select("status, status_verified, status_updated_by").eq("id", itemId).single().throwOnError();
  return data!;
};
// Pretend the cooldown has passed by moving this user's log rows into the past.
const ageLog = (userId: string, minutes = 60) =>
  admin.from("item_status_log").update({ created_at: new Date(Date.now() - minutes * 60_000).toISOString() }).eq("user_id", userId).throwOnError();

async function main() {
  const a = await makeStudent("a");
  const b = await makeStudent("b");
  const c = await makeStudent("c");
  const students = [a, b, c];
  const itemIds: string[] = [];
  const makeItem = async (name: string) => {
    const { data } = await admin.from("items").insert({ name: `${name} ${stamp}`, categories: ["snacks"] }).select("id").single().throwOnError();
    itemIds.push(data!.id);
    return data!.id as string;
  };

  try {
    const towels = await makeItem("Status Test Paper Towels");

    // ----- report, repeat, replace -----
    check("A reports out", !(await set(a, towels, "out")).error);
    let s = await stateOf(towels);
    check("one report is verified straight away", s.status === "out" && s.status_verified && s.status_updated_by === a.id, s);
    const view = await createClient(url, anonKey).from("available_items").select("pending").eq("id", towels).single();
    check("public view does not mark it pending", view.data?.pending === false, view);

    check("A repeating the same status is allowed", !(await set(a, towels, "out")).error);
    check("B re-checking the same status records B", !(await set(b, towels, "out")).error && (await stateOf(towels)).status_updated_by === b.id);

    check("C changes it to in_stock", !(await set(c, towels, "in_stock")).error);
    s = await stateOf(towels);
    check("change replaces it and is verified", s.status === "in_stock" && s.status_verified && s.status_updated_by === c.id, s);

    // ----- cooldown -----
    const cool = await set(a, towels, "out");
    check("A is cooled down after touching the item", !!cool.error, cool);
    await ageLog(a.id);
    check("A can change it after the cooldown", !(await set(a, towels, "out")).error);

    const fix = await makeItem("Status Test Fix");
    await set(b, fix, "out");
    check("B can correct own report immediately", !(await set(b, fix, "low")).error && (await stateOf(fix)).status === "low");

    // ----- photos (apply_item_status, as resolve_job_existing/new call it) -----
    const photo = (u: Student, itemId: string, status: string) =>
      admin.rpc("apply_item_status", { p_item_id: itemId, p_status: status, p_user: u.id });
    const shot = await makeItem("Status Test Photo");
    await photo(a, shot, "in_stock");
    s = await stateOf(shot);
    check("a photo is verified straight away", s.status === "in_stock" && s.status_verified && s.status_updated_by === a.id, s);
    await photo(b, shot, "in_stock");
    s = await stateOf(shot);
    check("a photo of the same status changes nothing", s.status_updated_by === a.id, s);
    await photo(b, shot, "low");
    s = await stateOf(shot);
    check("a photo with a new status replaces it", s.status === "low" && s.status_verified && s.status_updated_by === b.id, s);

    // ----- cap -----
    const bulk: string[] = [];
    for (let i = 0; i < CAP + 1; i++) bulk.push(await makeItem(`Status Test Bulk ${i}`));
    let ok = 0;
    let firstErr: string | undefined;
    for (const id of bulk) {
      const r = await set(c, id, "out");
      if (r.error) firstErr ??= r.error.message;
      else ok++;
    }
    // C has made no 'out' reports yet (its towel report was in_stock), so the cap is the full 30.
    check(`cap stops at ${CAP} out reports in 24 hours`, ok === CAP && !!firstErr, { ok, firstErr });
    check("in_stock is not capped", !(await set(c, bulk[CAP], "in_stock")).error);
    await ageLog(c.id, 25 * 60);
    check("old out reports no longer count", !(await set(c, bulk[CAP], "out")).error);
  } finally {
    await admin.from("items").delete().in("id", itemIds);
    for (const st of students) await admin.auth.admin.deleteUser(st.id);
  }

  console.log(failures === 0 ? "\nAll status update checks passed." : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
