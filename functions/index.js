import {initializeApp} from "firebase-admin/app";
import {defineSecret} from "firebase-functions/params";
import {onCall, HttpsError} from "firebase-functions/v2/https";
import {createClient} from "@supabase/supabase-js";

initializeApp();

const SUPABASE_URL = defineSecret("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = defineSecret("SUPABASE_SERVICE_ROLE_KEY");
const TASKS_ADMIN_EMAILS = defineSecret("TASKS_ADMIN_EMAILS");

const SCHEDULE_STEP_MINUTES = 15;

const region = "europe-west1";
const sharedOptions = {
  region,
  secrets: [SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TASKS_ADMIN_EMAILS],
};

function parseAdminEmails() {
  return new Set(
    (TASKS_ADMIN_EMAILS.value() || "")
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean),
  );
}

function assertAuthorized(request) {
  const email = request.auth?.token?.email?.toLowerCase?.() || "";
  if (!email) {
    throw new HttpsError("unauthenticated", "You must be signed in.");
  }

  const allowedEmails = parseAdminEmails();
  if (allowedEmails.size > 0 && !allowedEmails.has(email)) {
    throw new HttpsError("permission-denied", "This account is not allowed to manage tasks.");
  }

  return email;
}

function getSupabaseAdmin() {
  return createClient(SUPABASE_URL.value(), SUPABASE_SERVICE_ROLE_KEY.value(), {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

function cleanText(value, fallback = "") {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

function normalizePriority(value) {
  const normalized = cleanText(value, "medium");
  return ["low", "medium", "high"].includes(normalized) ? normalized : "medium";
}

function normalizeStatus(value) {
  const normalized = cleanText(value, "todo");
  return ["todo", "doing", "done"].includes(normalized) ? normalized : "todo";
}

function normalizeRuleType(value) {
  const normalized = cleanText(value, "none");
  return ["none", "daily", "weekly", "interval"].includes(normalized) ? normalized : "none";
}

function normalizeChecklist(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => cleanText(item)).filter(Boolean);
}

function normalizeWeekdays(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => cleanText(item).toLowerCase())
    .filter((item) => ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].includes(item));
}

function isQuarterHourTime(value) {
  const normalized = cleanText(value);
  const match = normalized.match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59 && minutes % SCHEDULE_STEP_MINUTES === 0;
}

async function resolveAgentSlugForOwner(supabase, ownerId) {
  if (!ownerId) return "unassigned";

  const {data, error} = await supabase
    .from("task_owners")
    .select("slug, kind, is_active")
    .eq("id", ownerId)
    .single();

  if (error) {
    throw new HttpsError("invalid-argument", `Invalid ownerId: ${error.message}`);
  }

  if (data.kind !== "agent" || data.is_active === false) {
    return "unassigned";
  }

  return cleanText(data.slug, "unassigned").toLowerCase() || "unassigned";
}

async function ensureOwnersSeeded(supabase) {
  const seedRows = [
    {slug: "ben", name: "Ben", kind: "agent", is_active: true},
    {slug: "barney", name: "Barney", kind: "agent", is_active: true},
  ];

  const {error} = await supabase.from("task_owners").upsert(seedRows, {onConflict: "slug"});
  if (error) {
    throw new HttpsError(
      "failed-precondition",
      `Supabase task schema is not ready. Run the SQL setup first. (${error.message})`,
    );
  }
}

async function logEvent(supabase, {taskId = null, templateId = null, eventType, payload = {}}) {
  const {error} = await supabase.from("task_events").insert({
    task_id: taskId,
    template_id: templateId,
    event_type: eventType,
    payload,
  });

  if (error) {
    throw new HttpsError("internal", `Failed to log event: ${error.message}`);
  }
}

async function fetchOwners(supabase) {
  const {data, error} = await supabase
    .from("task_owners")
    .select("id, slug, name, kind, is_active")
    .eq("is_active", true)
    .order("name", {ascending: true});

  if (error) throw new HttpsError("internal", error.message);
  return data || [];
}

async function fetchTemplates(supabase) {
  const {data, error} = await supabase
    .from("task_templates")
    .select("id, name, description, priority, checklist_json, created_at, updated_at")
    .order("name", {ascending: true});

  if (error) throw new HttpsError("internal", error.message);
  return (data || []).map((template) => ({
    id: template.id,
    name: template.name,
    description: template.description,
    priority: template.priority,
    checklist: normalizeChecklist(template.checklist_json),
    created_at: template.created_at,
    updated_at: template.updated_at,
  }));
}

async function fetchSchedules(supabase) {
  const {data, error} = await supabase
    .from("task_schedules")
    .select(`
      id,
      name,
      task_id,
      template_id,
      owner_id,
      priority,
      rule_type,
      interval_minutes,
      time_of_day,
      weekdays_json,
      timezone,
      is_active,
      last_generated_at,
      generated_run_keys,
      created_at,
      updated_at,
      owner:task_owners (id, slug, name, kind, is_active),
      template:task_templates (id, name, description, priority)
    `)
    .order("updated_at", {ascending: false});

  if (error) throw new HttpsError("internal", error.message);

  return (data || []).map((schedule) => ({
    ...schedule,
    weekdays: normalizeWeekdays(schedule.weekdays_json),
  }));
}

async function fetchTaskUpdates(supabase, taskIds) {
  if (!Array.isArray(taskIds) || taskIds.length === 0) {
    return new Map();
  }

  const {data: runs, error: runsError} = await supabase
    .from("task_runs")
    .select("id, task_id")
    .in("task_id", taskIds)
    .order("created_at", {ascending: false});

  if (runsError) throw new HttpsError("internal", runsError.message);

  if (!runs || runs.length === 0) {
    return new Map();
  }

  const taskIdByRunId = new Map(runs.map((run) => [run.id, run.task_id]));
  const runIds = runs.map((run) => run.id);

  const {data: updates, error: updatesError} = await supabase
    .from("task_run_updates")
    .select("id, task_run_id, kind, status, progress_percent, current_step, message, metadata, created_at")
    .in("task_run_id", runIds)
    .order("created_at", {ascending: false});

  if (updatesError) throw new HttpsError("internal", updatesError.message);

  const updatesByTaskId = new Map();
  for (const update of updates || []) {
    const taskId = taskIdByRunId.get(update.task_run_id);
    if (!taskId) continue;
    const current = updatesByTaskId.get(taskId) || [];
    if (current.length >= 20) continue;
    current.push(update);
    updatesByTaskId.set(taskId, current);
  }

  return updatesByTaskId;
}

async function fetchTasks(supabase) {
  const [{data: tasksData, error: tasksError}, schedules] = await Promise.all([
    supabase
      .from("tasks")
      .select(`
        id,
        title,
        description,
        status,
        priority,
        owner_id,
        template_id,
        created_at,
        updated_at,
        completed_at,
        owner:task_owners (id, slug, name, kind, is_active),
        template:task_templates (id, name, description, priority)
      `)
      .order("updated_at", {ascending: false}),
    fetchSchedules(supabase),
  ]);

  if (tasksError) throw new HttpsError("internal", tasksError.message);

  const scheduleByTaskId = new Map(
    schedules.filter((schedule) => schedule.task_id).map((schedule) => [schedule.task_id, schedule]),
  );
  const taskIds = (tasksData || []).map((task) => task.id);
  const updatesByTaskId = await fetchTaskUpdates(supabase, taskIds);

  return (tasksData || []).map((task) => ({
    ...task,
    schedule: scheduleByTaskId.get(task.id) || null,
    updates: updatesByTaskId.get(task.id) || [],
  }));
}

async function fetchTaskById(supabase, taskId) {
  const [tasks] = await Promise.all([fetchTasks(supabase)]);
  const task = tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new HttpsError("not-found", "Task not found.");
  }
  return task;
}

async function fetchTemplateById(supabase, templateId) {
  const templates = await fetchTemplates(supabase);
  const template = templates.find((item) => item.id === templateId);
  if (!template) {
    throw new HttpsError("not-found", "Template not found.");
  }
  return template;
}

async function fetchScheduleForTask(supabase, taskId) {
  const schedules = await fetchSchedules(supabase);
  return schedules.find((item) => item.task_id === taskId) || null;
}

export const listTaskOwners = onCall(sharedOptions, async (request) => {
  assertAuthorized(request);
  const supabase = getSupabaseAdmin();
  await ensureOwnersSeeded(supabase);
  const owners = await fetchOwners(supabase);
  return {owners};
});

export const listTaskTemplates = onCall(sharedOptions, async (request) => {
  assertAuthorized(request);
  const supabase = getSupabaseAdmin();
  const templates = await fetchTemplates(supabase);
  return {templates};
});

export const listTaskSchedules = onCall(sharedOptions, async (request) => {
  assertAuthorized(request);
  const supabase = getSupabaseAdmin();
  const schedules = await fetchSchedules(supabase);
  return {schedules};
});

export const listTasks = onCall(sharedOptions, async (request) => {
  assertAuthorized(request);
  const supabase = getSupabaseAdmin();
  await ensureOwnersSeeded(supabase);
  const tasks = await fetchTasks(supabase);
  return {tasks};
});

export const createTask = onCall(sharedOptions, async (request) => {
  assertAuthorized(request);
  const title = cleanText(request.data?.title);
  const description = cleanText(request.data?.description);
  const ownerId = cleanText(request.data?.ownerId, "") || null;
  const priority = normalizePriority(request.data?.priority);
  const templateId = cleanText(request.data?.templateId, "") || null;
  const status = normalizeStatus(request.data?.status);

  if (!title) {
    throw new HttpsError("invalid-argument", "Task title is required.");
  }

  const supabase = getSupabaseAdmin();
  await ensureOwnersSeeded(supabase);

  const {data, error} = await supabase
    .from("tasks")
    .insert({
      title,
      description,
      status,
      priority,
      owner_id: ownerId,
      template_id: templateId,
    })
    .select("id")
    .single();

  if (error) throw new HttpsError("internal", error.message);

  await logEvent(supabase, {
    taskId: data.id,
    eventType: "task_created",
    payload: {title, owner_id: ownerId, template_id: templateId, status, priority},
  });

  const task = await fetchTaskById(supabase, data.id);
  return {task};
});

export const updateTask = onCall(sharedOptions, async (request) => {
  assertAuthorized(request);
  const taskId = cleanText(request.data?.taskId);
  const patch = request.data?.patch || {};

  if (!taskId) {
    throw new HttpsError("invalid-argument", "taskId is required.");
  }

  const update = {};

  if ("title" in patch) {
    const title = cleanText(patch.title);
    if (!title) throw new HttpsError("invalid-argument", "Task title cannot be empty.");
    update.title = title;
  }
  if ("description" in patch) update.description = cleanText(patch.description);
  if ("ownerId" in patch) update.owner_id = cleanText(patch.ownerId, "") || null;
  if ("priority" in patch) update.priority = normalizePriority(patch.priority);
  if ("status" in patch) update.status = normalizeStatus(patch.status);
  if ("templateId" in patch) update.template_id = cleanText(patch.templateId, "") || null;

  const supabase = getSupabaseAdmin();
  const {error} = await supabase.from("tasks").update(update).eq("id", taskId);
  if (error) throw new HttpsError("internal", error.message);

  if ("owner_id" in update) {
    const agentSlug = await resolveAgentSlugForOwner(supabase, update.owner_id);
    const {error: scheduleSyncError} = await supabase
      .from("task_schedules")
      .update({
        owner_id: update.owner_id,
        agent_slug: agentSlug,
      })
      .eq("task_id", taskId);
    if (scheduleSyncError) throw new HttpsError("internal", scheduleSyncError.message);
  }

  await logEvent(supabase, {
    taskId,
    eventType: "task_updated",
    payload: update,
  });

  const task = await fetchTaskById(supabase, taskId);
  return {task};
});

export const saveTaskSchedule = onCall(sharedOptions, async (request) => {
  assertAuthorized(request);
  const taskId = cleanText(request.data?.taskId);
  const scheduleInput = request.data?.schedule || {};

  if (!taskId) {
    throw new HttpsError("invalid-argument", "taskId is required.");
  }

  const supabase = getSupabaseAdmin();
  const task = await fetchTaskById(supabase, taskId);
  const existing = await fetchScheduleForTask(supabase, taskId);
  const ruleType = normalizeRuleType(scheduleInput.ruleType);

  if (ruleType === "none") {
    if (existing) {
      const {error} = await supabase.from("task_schedules").delete().eq("id", existing.id);
      if (error) throw new HttpsError("internal", error.message);
      await logEvent(supabase, {
        taskId,
        eventType: "task_schedule_deleted",
        payload: {schedule_id: existing.id},
      });
    }
    return {schedule: null};
  }

  const weekdays = normalizeWeekdays(scheduleInput.weekdays);
  const ownerId = cleanText(scheduleInput.ownerId, "") || task.owner_id || null;
  const agentSlug = await resolveAgentSlugForOwner(supabase, ownerId);
  const payload = {
    name: cleanText(scheduleInput.name, `${task.title} schedule`),
    task_id: taskId,
    template_id: null,
    owner_id: ownerId,
    agent_slug: agentSlug,
    priority: normalizePriority(scheduleInput.priority || task.priority),
    rule_type: ruleType,
    interval_minutes: ruleType === "interval" ? Number(scheduleInput.intervalMinutes || 0) : null,
    time_of_day: ruleType === "interval" ? null : cleanText(scheduleInput.timeOfDay, "12:00"),
    weekdays_json: ruleType === "weekly" ? weekdays : [],
    timezone: cleanText(scheduleInput.timezone, "Europe/Madrid"),
    is_active: scheduleInput.isActive !== false,
    last_generated_at: null,
    generated_run_keys: [],
  };

  if (ruleType === "interval" && !(payload.interval_minutes > 0)) {
    throw new HttpsError("invalid-argument", "Interval schedule requires minutes > 0.");
  }
  if (ruleType === "interval" && payload.interval_minutes % SCHEDULE_STEP_MINUTES !== 0) {
    throw new HttpsError(
      "invalid-argument",
      `Interval schedule must be in ${SCHEDULE_STEP_MINUTES}-minute increments.`,
    );
  }
  if (["daily", "weekly"].includes(ruleType) && !isQuarterHourTime(payload.time_of_day)) {
    throw new HttpsError(
      "invalid-argument",
      `Scheduled time must be on a ${SCHEDULE_STEP_MINUTES}-minute boundary (00, 15, 30, 45).`,
    );
  }
  if (ruleType === "weekly" && weekdays.length === 0) {
    throw new HttpsError("invalid-argument", "Weekly schedule requires at least one weekday.");
  }

  let scheduleId = existing?.id || null;
  if (existing) {
    const {error} = await supabase.from("task_schedules").update(payload).eq("id", existing.id);
    if (error) throw new HttpsError("internal", error.message);
  } else {
    const {data, error} = await supabase
      .from("task_schedules")
      .insert(payload)
      .select("id")
      .single();
    if (error) throw new HttpsError("internal", error.message);
    scheduleId = data.id;
  }

  await logEvent(supabase, {
    taskId,
    eventType: "task_schedule_saved",
    payload,
  });

  const schedule = await fetchScheduleForTask(supabase, taskId);
  return {schedule, scheduleId};
});

export const createTaskTemplate = onCall(sharedOptions, async (request) => {
  assertAuthorized(request);
  const name = cleanText(request.data?.name);
  const description = cleanText(request.data?.description);
  const priority = normalizePriority(request.data?.priority);
  const checklist = normalizeChecklist(request.data?.checklist);

  if (!name) {
    throw new HttpsError("invalid-argument", "Template name is required.");
  }

  const supabase = getSupabaseAdmin();
  const {data, error} = await supabase
    .from("task_templates")
    .insert({
      name,
      description,
      priority,
      checklist_json: checklist,
    })
    .select("id")
    .single();

  if (error) throw new HttpsError("internal", error.message);

  await logEvent(supabase, {
    templateId: data.id,
    eventType: "template_created",
    payload: {name, priority, checklist_count: checklist.length},
  });

  const template = await fetchTemplateById(supabase, data.id);
  return {template};
});

export const updateTaskTemplate = onCall(sharedOptions, async (request) => {
  assertAuthorized(request);
  const templateId = cleanText(request.data?.templateId);
  const patch = request.data?.patch || {};

  if (!templateId) {
    throw new HttpsError("invalid-argument", "templateId is required.");
  }

  const update = {};
  if ("name" in patch) {
    const name = cleanText(patch.name);
    if (!name) throw new HttpsError("invalid-argument", "Template name cannot be empty.");
    update.name = name;
  }
  if ("description" in patch) update.description = cleanText(patch.description);
  if ("priority" in patch) update.priority = normalizePriority(patch.priority);
  if ("checklist" in patch) update.checklist_json = normalizeChecklist(patch.checklist);

  const supabase = getSupabaseAdmin();
  const {error} = await supabase.from("task_templates").update(update).eq("id", templateId);
  if (error) throw new HttpsError("internal", error.message);

  await logEvent(supabase, {
    templateId,
    eventType: "template_updated",
    payload: update,
  });

  const template = await fetchTemplateById(supabase, templateId);
  return {template};
});

export const deleteTaskTemplate = onCall(sharedOptions, async (request) => {
  assertAuthorized(request);
  const templateId = cleanText(request.data?.templateId);
  if (!templateId) {
    throw new HttpsError("invalid-argument", "templateId is required.");
  }

  const supabase = getSupabaseAdmin();
  await logEvent(supabase, {
    templateId,
    eventType: "template_deleted",
    payload: {},
  });

  const {error} = await supabase.from("task_templates").delete().eq("id", templateId);
  if (error) throw new HttpsError("internal", error.message);
  return {ok: true};
});

export const createTaskFromTemplate = onCall(sharedOptions, async (request) => {
  assertAuthorized(request);
  const templateId = cleanText(request.data?.templateId);
  const overrides = request.data?.overrides || {};
  if (!templateId) {
    throw new HttpsError("invalid-argument", "templateId is required.");
  }

  const supabase = getSupabaseAdmin();
  const template = await fetchTemplateById(supabase, templateId);
  const {data, error} = await supabase
    .from("tasks")
    .insert({
      title: cleanText(overrides.title, template.name),
      description: cleanText(overrides.description, template.description),
      status: normalizeStatus(overrides.status),
      priority: normalizePriority(overrides.priority || template.priority),
      owner_id: cleanText(overrides.ownerId, "") || null,
      template_id: templateId,
    })
    .select("id")
    .single();

  if (error) throw new HttpsError("internal", error.message);

  await logEvent(supabase, {
    taskId: data.id,
    templateId,
    eventType: "task_created_from_template",
    payload: {template_id: templateId},
  });

  const task = await fetchTaskById(supabase, data.id);
  return {task};
});
