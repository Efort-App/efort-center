import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const DISPATCH_BEARER_TOKEN = Deno.env.get("OPENCLAW_PROGRESS_TOKEN") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function createTaskFromTemplate(schedule: any) {
  const { data: template, error } = await supabase
    .from("task_templates")
    .select("id, name, description, priority")
    .eq("id", schedule.template_id)
    .single();

  if (error) throw error;

  const { data: task, error: insertError } = await supabase
    .from("tasks")
    .insert({
      title: template.name,
      description: template.description,
      status: "todo",
      priority: schedule.priority || template.priority,
      owner_id: schedule.owner_id || null,
      template_id: template.id,
    })
    .select("id")
    .single();

  if (insertError) throw insertError;
  return task.id;
}

async function addRunUpdate(taskRunId: string, payload: Record<string, unknown>) {
  const { error } = await supabase.from("task_run_updates").insert({
    task_run_id: taskRunId,
    kind: payload.kind || "system",
    status: payload.status || null,
    progress_percent: payload.progress_percent || null,
    current_step: payload.current_step || null,
    message: payload.message,
    metadata: payload.metadata || {},
  });

  if (error) throw error;
}

Deno.serve(async (req) => {
  try {
    if (DISPATCH_BEARER_TOKEN) {
      const auth = req.headers.get("authorization") || "";
      const bearer = auth.replace(/^Bearer\s+/i, "");
      if (bearer !== DISPATCH_BEARER_TOKEN) {
        return json({ error: "unauthorized" }, 401);
      }
    }

    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    const limit = Number(body.limit || 25);

    const { data: schedules, error } = await supabase.rpc("claim_due_task_schedules", {
      p_limit: limit,
    });

    if (error) throw error;

    const results = [];

    for (const schedule of schedules || []) {
      try {
        const taskId = schedule.task_id || (await createTaskFromTemplate(schedule));
        const dueSlot = schedule.due_slot;

        const runPayload = {
          task_id: taskId,
          schedule_id: schedule.id,
          due_slot: dueSlot,
          agent_slug: schedule.agent_slug,
          status: "queued",
          current_step: "Queued for OpenClaw worker",
          latest_update: "Task run created by Supabase scheduler.",
          progress_percent: 0,
          last_heartbeat_at: null,
          metadata: {
            schedule_name: schedule.name,
            dispatch_source: "supabase-cron",
          },
        };

        const { data: taskRun, error: taskRunError } = await supabase
          .from("task_runs")
          .upsert(runPayload, { onConflict: "schedule_id,due_slot" })
          .select("id, task_id, schedule_id")
          .single();

        if (taskRunError) throw taskRunError;

        await addRunUpdate(taskRun.id, {
          kind: "system",
          status: "queued",
          message: "Scheduled task queued for local OpenClaw worker.",
          current_step: "Queued",
        });

        results.push({ scheduleId: schedule.id, taskId, taskRunId: taskRun.id, ok: true });
      } catch (scheduleError) {
        const message = scheduleError instanceof Error ? scheduleError.message : String(scheduleError);
        await supabase
          .from("task_schedules")
          .update({ last_dispatch_error: message })
          .eq("id", schedule.id);
        results.push({ scheduleId: schedule.id, ok: false, error: message });
      }
    }

    return json({ ok: true, processed: results.length, results });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      500,
    );
  }
});
