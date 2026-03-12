import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const OPENCLAW_PROGRESS_TOKEN = Deno.env.get("OPENCLAW_PROGRESS_TOKEN") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function normalizeStatus(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["queued", "dispatched", "running", "blocked", "waiting_human", "done", "failed"].includes(normalized)
    ? normalized
    : null;
}

function normalizeKind(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  return ["status_change", "progress", "note", "blocker", "subagent_started", "subagent_finished", "system"].includes(normalized)
    ? normalized
    : "note";
}

Deno.serve(async (req) => {
  try {
    if (OPENCLAW_PROGRESS_TOKEN) {
      const auth = req.headers.get("authorization") || "";
      const bearer = auth.replace(/^Bearer\s+/i, "");
      if (bearer !== OPENCLAW_PROGRESS_TOKEN) {
        return json({ error: "unauthorized" }, 401);
      }
    }

    const body = await req.json();
    const taskRunId = String(body.taskRunId || "").trim();
    const status = normalizeStatus(body.status);
    const kind = normalizeKind(body.kind || (status ? "status_change" : "note"));
    const message = String(body.message || "").trim();
    const progressPercent = body.progressPercent === undefined || body.progressPercent === null
      ? null
      : Number(body.progressPercent);
    const currentStep = String(body.currentStep || "").trim() || null;
    const metadata = body.metadata && typeof body.metadata === "object" ? body.metadata : {};

    if (!taskRunId || !message) {
      return json({ error: "taskRunId and message are required" }, 400);
    }

    const updatePayload: Record<string, unknown> = {
      latest_update: message,
      current_step: currentStep,
      last_heartbeat_at: new Date().toISOString(),
    };

    if (status) updatePayload.status = status;
    if (progressPercent !== null && Number.isFinite(progressPercent)) {
      updatePayload.progress_percent = Math.max(0, Math.min(100, progressPercent));
    }
    if (status === "done" || status === "failed") {
      updatePayload.finished_at = new Date().toISOString();
    }

    const { data: existingRun, error: runError } = await supabase
      .from("task_runs")
      .select("id, task_id, status")
      .eq("id", taskRunId)
      .single();

    if (runError) throw runError;

    const { error: updateError } = await supabase.from("task_runs").update(updatePayload).eq("id", taskRunId);
    if (updateError) throw updateError;

    const { error: insertUpdateError } = await supabase.from("task_run_updates").insert({
      task_run_id: taskRunId,
      kind,
      status,
      progress_percent: updatePayload.progress_percent || null,
      current_step: currentStep,
      message,
      metadata,
    });

    if (insertUpdateError) throw insertUpdateError;

    if (status === "running") {
      await supabase.from("tasks").update({ status: "doing" }).eq("id", existingRun.task_id);
    }
    if (status === "done") {
      await supabase.from("tasks").update({ status: "done" }).eq("id", existingRun.task_id);
    }

    return json({ ok: true });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
