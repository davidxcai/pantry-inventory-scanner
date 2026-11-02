// Identify one intake job: Gemini chain, then name match, then write the result.
// Shared by /api/identify (a user's request) and /api/sweep (the daily quota retry).

import { decide, ModelOutputSchema, type Decision } from "../../shared/guardrail.js";
import { IDENTIFY_SYSTEM } from "../../shared/identifyItem.js";
import { matchJob } from "../../shared/matchJob.js";
import { TIERS, runChain } from "../../shared/modelChain.js";
import { admin } from "./clients.js";
import { downloadPhotoBase64, generateJson, loadCatalog, quotaDeps } from "./gemini.js";

// Claim the job so a double tap, a retry or the sweep cannot run it twice at once.
// Pass the caller's id to restrict the claim to their own job; the sweep claims any.
export async function claimJob(jobId: string, userId?: string) {
  let query = admin
    .from("intake_jobs")
    .update({ status: "processing" })
    .eq("id", jobId)
    .in("status", ["queued", "waiting_quota", "red"]);
  if (userId) query = query.eq("created_by", userId);
  const { data, error } = await query.select("photo_path, attempts").maybeSingle();
  if (error) throw error;
  return data;
}

// "cancelled": the user cancelled the job while it was being identified; nothing was written.
export type JobOutcome = "green" | "yellow" | "red" | "waiting_quota" | "rejected" | "cancelled";

export async function runJob(jobId: string, claimed: { photo_path: string; attempts: number }): Promise<JobOutcome> {
  try {
    const image = await downloadPhotoBase64(claimed.photo_path);

    const result = await runChain<Decision>(TIERS, {
      call: async (model) => {
        const out = await generateJson(model, {
          image,
          prompt: "Identify and categorize this product.",
          system: IDENTIFY_SYSTEM,
          schema: ModelOutputSchema,
        });
        if (out.blocked) return { kind: "reject", reason: "inappropriate" };
        return decide(ModelOutputSchema.parse(out.json));
      },
      ...quotaDeps(),
    });

    const attempts = (claimed.attempts ?? 0) + result.attempts;

    if (result.kind !== "ok") {
      const status = result.kind === "waiting_quota" ? "waiting_quota" : "red";
      const error = result.kind === "failed" ? result.error : "all models are out of quota today";
      if (!(await writeUnlessCancelled(jobId, { status, attempts, error }))) return "cancelled";
      return status;
    }

    if (result.value.kind === "reject") {
      // Nothing is created. The thumbnail bucket is public, so take the photo out of it; the
      // full-size copy stays in the private bucket for auditing.
      await admin.storage.from("thumbnails").remove([`${jobId}.jpg`]);
      const fields = { status: "rejected", reject_reason: result.value.reason, identified: null, model_used: result.model, attempts, error: null };
      if (!(await writeUnlessCancelled(jobId, fields))) return "cancelled";
      return "rejected";
    }
    const item = result.value.item;
    // Keep what Gemini read, so the user can resolve the job from the review screen.
    if (!(await writeUnlessCancelled(jobId, { identified: item, model_used: result.model, attempts }))) return "cancelled";

    const match = matchJob(item.name, await loadCatalog());
    if (match.kind === "green") {
      const { error } = await admin.rpc("resolve_job_existing", { p_job_id: jobId, p_item_id: match.itemId, p_model: result.model });
      if (error) throw error;
      return "green";
    }
    if (match.kind === "yellow") {
      // No item yet: the user picks a candidate or creates a new one.
      if (!(await writeUnlessCancelled(jobId, { status: "yellow", candidates: match.candidates }))) return "cancelled";
      return "yellow";
    }
    // New item: create it now with the status the user chose, and show it yellow once so the user can check it.
    const { error } = await admin.rpc("resolve_job_new", {
      p_job_id: jobId,
      p_name: item.name,
      p_brand: item.brand,
      p_size: item.size,
      p_categories: item.categories,
      p_status: "yellow",
      p_model: result.model,
    });
    if (error) throw error;
    return "yellow";
  } catch (err) {
    // Unexpected failure: leave the job retryable instead of stuck in "processing".
    // The resolve functions refuse a job cancelled mid-run; that is not a failure.
    const message = err instanceof Error ? err.message : String(err);
    if (!(await writeUnlessCancelled(jobId, { status: "red", error: message.slice(0, 300) }))) return "cancelled";
    throw err;
  }
}

// Update a job unless the user cancelled it while it was running, so a late result never
// revives it. Returns false when the job was cancelled and nothing was written.
async function writeUnlessCancelled(jobId: string, fields: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await admin
    .from("intake_jobs")
    .update(fields)
    .eq("id", jobId)
    .neq("status", "cancelled")
    .select("id");
  if (error) throw error;
  return data.length > 0;
}
