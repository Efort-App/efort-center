const STORAGE_KEY = "efort-center.tasks.workspace.v5";
const DEFAULT_TIMEZONE = "Europe/Madrid";
const WEEKDAY_OPTIONS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

const SAMPLE_OWNERS = [
  {
    id: "owner-ben",
    slug: "ben",
    name: "Ben",
    kind: "agent",
    avatar: "B",
    color: "teal",
  },
  {
    id: "owner-barney",
    slug: "barney",
    name: "Barney",
    kind: "agent",
    avatar: "R",
    color: "violet",
  },
];

const SAMPLE_TEMPLATES = [
  {
    id: "template-daily-ops",
    name: "Daily ops review",
    description: "Check the task board, identify blockers, and assign next actions for today.",
    owner_id: null,
    priority: "medium",
    checklist: ["Review active tasks", "Identify blocked work", "Assign next actions"],
  },
  {
    id: "template-cloud-functions",
    name: "Cloud functions QA",
    description: "Review Firebase cloud functions, validate expected behavior, and capture issues.",
    owner_id: null,
    priority: "high",
    checklist: ["Check logs and deploy status", "Run smoke tests", "Create follow-up tasks for failures"],
  },
  {
    id: "template-content-sync",
    name: "Content sync",
    description: "Sync product changes into Efort Center docs, templates, and operational notes.",
    owner_id: null,
    priority: "low",
    checklist: ["Review product updates", "Update templates", "Log changes for the team"],
  },
];

const SAMPLE_TASKS = [
  {
    id: "task-1",
    title: "Define Force Center task architecture",
    description: "Lock the MVP entities, task statuses, template model, and ownership rules before backend hookup.",
    status: "todo",
    priority: "high",
    owner_id: "owner-ben",
    template_id: "template-daily-ops",
    created_at: "2026-03-11T09:00:00.000Z",
    updated_at: "2026-03-11T09:00:00.000Z",
  },
  {
    id: "task-2",
    title: "QA nutrition sync cloud functions",
    description: "Verify expected output paths, log failures, and propose fixes for regressions.",
    status: "doing",
    priority: "high",
    owner_id: "owner-ben",
    template_id: "template-cloud-functions",
    created_at: "2026-03-11T08:40:00.000Z",
    updated_at: "2026-03-11T10:20:00.000Z",
  },
  {
    id: "task-3",
    title: "Create onboarding checklist templates",
    description: "Prepare reusable templates for recurring operator workflows in Efort Center.",
    status: "todo",
    priority: "medium",
    owner_id: "owner-barney",
    template_id: "template-content-sync",
    created_at: "2026-03-11T08:10:00.000Z",
    updated_at: "2026-03-11T08:10:00.000Z",
  },
  {
    id: "task-4",
    title: "Ship Kanban board prototype",
    description: "Build board interactions, assignment controls, and a clean linear-style UI in white mode.",
    status: "doing",
    priority: "high",
    owner_id: "owner-ben",
    template_id: null,
    created_at: "2026-03-11T07:50:00.000Z",
    updated_at: "2026-03-11T11:45:00.000Z",
  },
  {
    id: "task-5",
    title: "Document Supabase plug-in path",
    description: "Keep the repository abstraction stable so we can swap mock storage for Supabase later.",
    status: "done",
    priority: "medium",
    owner_id: "owner-ben",
    template_id: null,
    created_at: "2026-03-10T18:15:00.000Z",
    updated_at: "2026-03-11T07:15:00.000Z",
    completed_at: "2026-03-11T07:15:00.000Z",
  },
  {
    id: "task-6",
    title: "Draft operator handoff notes",
    description: "Write short handoff notes so another agent can continue the task without context loss.",
    status: "done",
    priority: "low",
    owner_id: "owner-barney",
    template_id: "template-content-sync",
    created_at: "2026-03-10T16:00:00.000Z",
    updated_at: "2026-03-10T20:30:00.000Z",
    completed_at: "2026-03-10T20:30:00.000Z",
  },
];

const SAMPLE_TASK_UPDATES = [
  {
    id: "update-1",
    task_id: "task-1",
    kind: "status_change",
    message: "Task created and queued for review.",
    created_at: "2026-03-11T09:00:00.000Z",
  },
  {
    id: "update-2",
    task_id: "task-1",
    kind: "note",
    message: "Defined initial entities: tasks, templates, owners, schedules.",
    created_at: "2026-03-11T09:10:00.000Z",
  },
  {
    id: "update-3",
    task_id: "task-2",
    kind: "status_change",
    message: "Started reviewing nutrition sync cloud functions.",
    created_at: "2026-03-11T08:40:00.000Z",
  },
  {
    id: "update-4",
    task_id: "task-2",
    kind: "progress",
    message: "Checked expected outputs and compared current paths against regressions.",
    created_at: "2026-03-11T09:05:00.000Z",
  },
  {
    id: "update-5",
    task_id: "task-2",
    kind: "blocker",
    message: "Need production credentials to validate live cloud function behavior.",
    created_at: "2026-03-11T10:20:00.000Z",
  },
  {
    id: "update-6",
    task_id: "task-4",
    kind: "status_change",
    message: "Started implementing the Efort Center Kanban board.",
    created_at: "2026-03-11T07:50:00.000Z",
  },
  {
    id: "update-7",
    task_id: "task-4",
    kind: "progress",
    message: "Built task cards, owner assignment, and drag-and-drop interactions.",
    created_at: "2026-03-11T10:35:00.000Z",
  },
  {
    id: "update-8",
    task_id: "task-4",
    kind: "progress",
    message: "Refined the sidebar and task detail modal to match the latest UI direction.",
    created_at: "2026-03-11T11:45:00.000Z",
  },
  {
    id: "update-9",
    task_id: "task-5",
    kind: "done",
    message: "Documented the Supabase migration path and mock-to-real backend strategy.",
    created_at: "2026-03-11T07:15:00.000Z",
  },
];

const SAMPLE_SCHEDULES = [
  {
    id: "schedule-daily-ops",
    name: "Daily ops at 12:00",
    template_id: "template-daily-ops",
    owner_id: "owner-ben",
    priority: "medium",
    rule_type: "daily",
    interval_minutes: null,
    time_of_day: "12:00",
    weekdays: [],
    source_task_id: null,
    timezone: DEFAULT_TIMEZONE,
    is_active: true,
    created_at: "2026-03-11T07:00:00.000Z",
    updated_at: "2026-03-11T07:00:00.000Z",
    last_generated_at: null,
    generated_run_keys: ["daily:2026-03-11:12:00"],
  },
  {
    id: "schedule-cloud-weekly",
    name: "Cloud QA M/W/F at 09:00",
    template_id: "template-cloud-functions",
    owner_id: "owner-ben",
    priority: "high",
    rule_type: "weekly",
    interval_minutes: null,
    time_of_day: "09:00",
    weekdays: ["mon", "wed", "fri"],
    source_task_id: null,
    timezone: DEFAULT_TIMEZONE,
    is_active: true,
    created_at: "2026-03-11T07:00:00.000Z",
    updated_at: "2026-03-11T07:00:00.000Z",
    last_generated_at: null,
    generated_run_keys: ["weekly:wed:2026-03-11:09:00"],
  },
];

function pad(value) {
  return String(value).padStart(2, "0");
}

function getNow() {
  return new Date();
}

function getNowIso() {
  return getNow().toISOString();
}

function formatLocalDateKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function localDateFromIso(value) {
  const parsed = new Date(value || 0);
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
}

function parseTimeToMinutes(value) {
  if (!value || !/^\d{2}:\d{2}$/.test(value)) return 0;
  const [hours, minutes] = value.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function formatWeekday(date) {
  const days = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
  return days[date.getDay()] || "mon";
}

function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function sortTasks(tasks) {
  return tasks.slice().sort((left, right) => {
    const leftTime = new Date(left.updated_at || left.created_at || 0).getTime();
    const rightTime = new Date(right.updated_at || right.created_at || 0).getTime();
    return rightTime - leftTime;
  });
}

function makeId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function createDefaultWorkspace() {
  return {
    owners: SAMPLE_OWNERS,
    templates: SAMPLE_TEMPLATES,
    tasks: SAMPLE_TASKS,
    task_updates: SAMPLE_TASK_UPDATES,
    schedules: SAMPLE_SCHEDULES,
  };
}

function writeWorkspace(workspace) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(workspace));
}

function normalizeWorkspace(parsed) {
  return {
    owners: Array.isArray(parsed.owners) ? parsed.owners : SAMPLE_OWNERS,
    templates: Array.isArray(parsed.templates) ? parsed.templates : SAMPLE_TEMPLATES,
    tasks: Array.isArray(parsed.tasks) ? parsed.tasks : SAMPLE_TASKS,
    task_updates: Array.isArray(parsed.task_updates) ? parsed.task_updates : SAMPLE_TASK_UPDATES,
    schedules: Array.isArray(parsed.schedules) ? parsed.schedules : SAMPLE_SCHEDULES,
  };
}

function cloneWorkspace(workspace) {
  return JSON.parse(JSON.stringify(workspace));
}

function buildTaskUpdate(taskId, kind, message) {
  return {
    id: makeId("update"),
    task_id: taskId,
    kind,
    message,
    created_at: getNowIso(),
  };
}

function appendTaskUpdate(workspace, taskId, kind, message) {
  workspace.task_updates = workspace.task_updates || [];
  workspace.task_updates.unshift(buildTaskUpdate(taskId, kind, message));
}

function buildTaskRecord(workspace, input) {
  const now = getNowIso();
  return {
    id: makeId("task"),
    title: String(input.title || "").trim(),
    description: String(input.description || "").trim(),
    status: input.status || "todo",
    priority: input.priority || "medium",
    owner_id: input.ownerId || null,
    template_id: input.templateId || null,
    schedule_id: input.scheduleId || null,
    schedule_run_key: input.scheduleRunKey || null,
    created_at: now,
    updated_at: now,
    completed_at: input.status === "done" ? now : null,
  };
}

function createTaskInWorkspace(workspace, input) {
  const task = buildTaskRecord(workspace, input);
  workspace.tasks.unshift(task);
  appendTaskUpdate(workspace, task.id, "status_change", "Task created and queued.");
  return task;
}

function getTemplateDefaults(workspace, templateId) {
  const template = workspace.templates.find((item) => item.id === templateId);
  if (!template) {
    throw new Error("Template not found.");
  }

  return {
    title: template.name,
    description: template.description,
    ownerId: null,
    priority: template.priority || "medium",
    templateId: template.id,
  };
}

function createTaskFromTemplateInWorkspace(workspace, templateId, overrides = {}) {
  const defaults = getTemplateDefaults(workspace, templateId);
  return createTaskInWorkspace(workspace, {
    title: overrides.title || defaults.title,
    description: overrides.description || defaults.description,
    ownerId: overrides.ownerId || defaults.ownerId,
    priority: overrides.priority || defaults.priority,
    templateId: defaults.templateId,
    status: overrides.status || "todo",
    scheduleId: overrides.scheduleId || null,
    scheduleRunKey: overrides.scheduleRunKey || null,
  });
}

function getDailyRunKeys(schedule, now) {
  const createdAt = localDateFromIso(schedule.created_at);
  const keys = [];
  const minutesOfDay = parseTimeToMinutes(schedule.time_of_day || "00:00");
  const cursor = new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate());
  const lastDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  while (cursor <= lastDate && keys.length < 30) {
    const runAt = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 0, minutesOfDay, 0, 0);
    if (runAt <= now) {
      keys.push(`daily:${formatLocalDateKey(cursor)}:${schedule.time_of_day || "00:00"}`);
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return keys;
}

function getWeeklyRunKeys(schedule, now) {
  const createdAt = localDateFromIso(schedule.created_at);
  const keys = [];
  const activeWeekdays = new Set(Array.isArray(schedule.weekdays) ? schedule.weekdays : []);
  const minutesOfDay = parseTimeToMinutes(schedule.time_of_day || "00:00");
  const cursor = new Date(createdAt.getFullYear(), createdAt.getMonth(), createdAt.getDate());
  const lastDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  while (cursor <= lastDate && keys.length < 40) {
    if (activeWeekdays.has(formatWeekday(cursor))) {
      const runAt = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate(), 0, minutesOfDay, 0, 0);
      if (runAt <= now) {
        keys.push(`weekly:${formatWeekday(cursor)}:${formatLocalDateKey(cursor)}:${schedule.time_of_day || "00:00"}`);
      }
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  return keys;
}

function getIntervalRunKeys(schedule, now) {
  const createdAt = localDateFromIso(schedule.created_at);
  const intervalMinutes = Math.max(1, Number(schedule.interval_minutes || 0));
  const keys = [];
  let cursor = new Date(createdAt);

  while (cursor <= now && keys.length < 50) {
    keys.push(`interval:${intervalMinutes}:${cursor.getTime()}`);
    cursor = addMinutes(cursor, intervalMinutes);
  }

  return keys;
}

function getDueRunKeys(schedule, now) {
  if (!schedule.is_active) return [];
  if (schedule.rule_type === "interval") return getIntervalRunKeys(schedule, now);
  if (schedule.rule_type === "weekly") return getWeeklyRunKeys(schedule, now);
  return getDailyRunKeys(schedule, now);
}

function materializeSchedules(workspace) {
  const now = getNow();
  let changed = false;

  for (const schedule of workspace.schedules) {
    const existingKeys = new Set(Array.isArray(schedule.generated_run_keys) ? schedule.generated_run_keys : []);
    const dueKeys = getDueRunKeys(schedule, now);

    for (const runKey of dueKeys) {
      if (existingKeys.has(runKey)) continue;

      if (schedule.source_task_id) {
        const sourceTask = workspace.tasks.find((task) => task.id === schedule.source_task_id);
        if (sourceTask) {
          createTaskInWorkspace(workspace, {
            title: sourceTask.title,
            description: sourceTask.description,
            ownerId: schedule.owner_id || sourceTask.owner_id || null,
            priority: schedule.priority || sourceTask.priority || "medium",
            templateId: sourceTask.template_id || null,
            status: "todo",
            scheduleId: schedule.id,
            scheduleRunKey: runKey,
          });
        }
      } else {
        createTaskFromTemplateInWorkspace(workspace, schedule.template_id, {
          ownerId: schedule.owner_id || null,
          priority: schedule.priority || "medium",
          scheduleId: schedule.id,
          scheduleRunKey: runKey,
        });
      }

      existingKeys.add(runKey);
      schedule.generated_run_keys = Array.from(existingKeys).slice(-100);
      schedule.last_generated_at = getNowIso();
      schedule.updated_at = getNowIso();
      changed = true;
    }
  }

  return changed;
}

function readWorkspace() {
  const raw = window.localStorage.getItem(STORAGE_KEY);
  if (!raw) {
    const seeded = createDefaultWorkspace();
    materializeSchedules(seeded);
    writeWorkspace(seeded);
    return seeded;
  }

  try {
    const workspace = normalizeWorkspace(JSON.parse(raw));
    if (materializeSchedules(workspace)) {
      writeWorkspace(workspace);
    }
    return workspace;
  } catch {
    const seeded = createDefaultWorkspace();
    materializeSchedules(seeded);
    writeWorkspace(seeded);
    return seeded;
  }
}

function joinRelations(workspace) {
  const updatesByTaskId = new Map();
  for (const update of workspace.task_updates || []) {
    const current = updatesByTaskId.get(update.task_id) || [];
    current.push(update);
    updatesByTaskId.set(update.task_id, current);
  }

  return {
    owners: workspace.owners.slice(),
    templates: workspace.templates.map((template) => ({
      ...template,
      owner: workspace.owners.find((owner) => owner.id === template.owner_id) || null,
    })),
    tasks: sortTasks(
      workspace.tasks.map((task) => ({
        ...task,
        owner: workspace.owners.find((owner) => owner.id === task.owner_id) || null,
        template: workspace.templates.find((template) => template.id === task.template_id) || null,
        schedule:
          workspace.schedules.find((schedule) => schedule.source_task_id === task.id) || null,
        updates: (updatesByTaskId.get(task.id) || [])
          .slice()
          .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
      })),
    ),
    schedules: workspace.schedules.map((schedule) => ({
      ...schedule,
      owner: workspace.owners.find((owner) => owner.id === schedule.owner_id) || null,
      template: workspace.templates.find((template) => template.id === schedule.template_id) || null,
      sourceTask: workspace.tasks.find((task) => task.id === schedule.source_task_id) || null,
    })),
  };
}

export async function loadMockWorkspace() {
  return joinRelations(readWorkspace());
}

export async function createMockTask(input) {
  const workspace = cloneWorkspace(readWorkspace());
  const task = createTaskInWorkspace(workspace, input);
  writeWorkspace(workspace);
  return joinRelations(workspace).tasks.find((item) => item.id === task.id);
}

export async function updateMockTask(taskId, patch) {
  const workspace = cloneWorkspace(readWorkspace());
  const task = workspace.tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new Error("Task not found.");
  }

  const changes = [];
  if (patch.title !== undefined) {
    task.title = String(patch.title || "").trim();
    changes.push("Updated title.");
  }
  if (patch.description !== undefined) {
    task.description = String(patch.description || "").trim();
    changes.push("Updated description.");
  }
  if (patch.ownerId !== undefined) {
    task.owner_id = patch.ownerId || null;
    changes.push("Updated owner.");
  }
  if (patch.priority !== undefined) {
    task.priority = patch.priority;
    changes.push(`Priority set to ${patch.priority}.`);
  }
  if (patch.status !== undefined) {
    task.status = patch.status;
    task.completed_at = patch.status === "done" ? getNowIso() : null;
    changes.push(`Status changed to ${patch.status}.`);
  }

  task.updated_at = getNowIso();
  if (changes.length > 0) {
    appendTaskUpdate(workspace, task.id, "progress", changes.join(" "));
  }
  writeWorkspace(workspace);
  return joinRelations(workspace).tasks.find((item) => item.id === task.id);
}

export async function deleteMockTask(taskId) {
  const workspace = cloneWorkspace(readWorkspace());
  const task = workspace.tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new Error("Task not found.");
  }

  workspace.tasks = workspace.tasks.filter((item) => item.id !== taskId);
  workspace.task_updates = (workspace.task_updates || []).filter((update) => update.task_id !== taskId);
  workspace.schedules = workspace.schedules.filter((schedule) => schedule.source_task_id !== taskId);
  writeWorkspace(workspace);
  return {ok: true};
}

export async function createMockTaskFromTemplate(templateId, overrides = {}) {
  const workspace = cloneWorkspace(readWorkspace());
  const task = createTaskFromTemplateInWorkspace(workspace, templateId, overrides);
  writeWorkspace(workspace);
  return joinRelations(workspace).tasks.find((item) => item.id === task.id);
}

export async function createMockTemplate(input) {
  const workspace = cloneWorkspace(readWorkspace());
  const template = {
    id: makeId("template"),
    name: String(input.name || "").trim(),
    description: String(input.description || "").trim(),
    owner_id: null,
    priority: input.priority || "medium",
    checklist: Array.isArray(input.checklist) ? input.checklist.filter(Boolean) : [],
  };

  workspace.templates.unshift(template);
  writeWorkspace(workspace);
  return joinRelations(workspace).templates.find((item) => item.id === template.id);
}

export async function updateMockTemplate(templateId, patch) {
  const workspace = cloneWorkspace(readWorkspace());
  const template = workspace.templates.find((item) => item.id === templateId);
  if (!template) {
    throw new Error("Template not found.");
  }

  if (patch.name !== undefined) template.name = String(patch.name || "").trim();
  if (patch.description !== undefined) template.description = String(patch.description || "").trim();
  if (patch.priority !== undefined) template.priority = patch.priority;
  if (patch.checklist !== undefined) template.checklist = Array.isArray(patch.checklist) ? patch.checklist.filter(Boolean) : [];

  writeWorkspace(workspace);
  return joinRelations(workspace).templates.find((item) => item.id === template.id);
}

export async function deleteMockTemplate(templateId) {
  const workspace = cloneWorkspace(readWorkspace());
  workspace.templates = workspace.templates.filter((item) => item.id !== templateId);
  workspace.tasks = workspace.tasks.map((task) =>
    task.template_id === templateId ? {...task, template_id: null} : task,
  );
  workspace.schedules = workspace.schedules.filter((schedule) => schedule.template_id !== templateId);
  writeWorkspace(workspace);
  return {ok: true};
}

const SCHEDULE_STEP_MINUTES = 15;

function isQuarterHourTime(value) {
  const match = String(value || "").trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  return Number(match[2]) % SCHEDULE_STEP_MINUTES === 0;
}

function validateSchedule(schedule) {
  if (!schedule.name) {
    throw new Error("Schedule name is required.");
  }
  if (!schedule.template_id && !schedule.source_task_id) {
    throw new Error("Schedule source is required.");
  }
  if (schedule.rule_type === "interval" && !(schedule.interval_minutes > 0)) {
    throw new Error("Interval schedule requires minutes > 0.");
  }
  if (schedule.rule_type === "interval" && schedule.interval_minutes % SCHEDULE_STEP_MINUTES !== 0) {
    throw new Error(`Interval schedule must be in ${SCHEDULE_STEP_MINUTES}-minute increments.`);
  }
  if (["daily", "weekly"].includes(schedule.rule_type) && !isQuarterHourTime(schedule.time_of_day)) {
    throw new Error(
      `Scheduled time must be on a ${SCHEDULE_STEP_MINUTES}-minute boundary (00, 15, 30, 45).`,
    );
  }
  if (schedule.rule_type === "weekly" && schedule.weekdays.length === 0) {
    throw new Error("Weekly schedule requires at least one weekday.");
  }
}

export async function createMockSchedule(input) {
  const workspace = cloneWorkspace(readWorkspace());
  const schedule = {
    id: makeId("schedule"),
    name: String(input.name || "").trim(),
    template_id: input.templateId || null,
    source_task_id: input.sourceTaskId || null,
    owner_id: input.ownerId || null,
    priority: input.priority || "medium",
    rule_type: input.ruleType || "daily",
    interval_minutes: input.ruleType === "interval" ? Number(input.intervalMinutes || 0) : null,
    time_of_day: input.ruleType === "interval" ? null : input.timeOfDay || "12:00",
    weekdays: input.ruleType === "weekly" ? (Array.isArray(input.weekdays) ? input.weekdays : []) : [],
    timezone: input.timezone || DEFAULT_TIMEZONE,
    is_active: input.isActive !== false,
    created_at: getNowIso(),
    updated_at: getNowIso(),
    last_generated_at: null,
    generated_run_keys: [],
  };

  validateSchedule(schedule);
  workspace.schedules.unshift(schedule);
  materializeSchedules(workspace);
  writeWorkspace(workspace);
  return joinRelations(workspace).schedules.find((item) => item.id === schedule.id);
}

export async function saveMockTaskSchedule(taskId, input) {
  const workspace = cloneWorkspace(readWorkspace());
  const task = workspace.tasks.find((item) => item.id === taskId);
  if (!task) {
    throw new Error("Task not found.");
  }

  workspace.schedules = workspace.schedules.filter((schedule) => schedule.source_task_id !== taskId);

  if (!input || input.ruleType === "none") {
    appendTaskUpdate(workspace, taskId, "note", "Removed task schedule.");
    writeWorkspace(workspace);
    return null;
  }

  const schedule = {
    id: makeId("schedule"),
    name: String(input.name || `${task.title} schedule`).trim(),
    template_id: task.template_id || null,
    source_task_id: taskId,
    owner_id: input.ownerId || task.owner_id || null,
    priority: input.priority || task.priority || "medium",
    rule_type: input.ruleType || "daily",
    interval_minutes: input.ruleType === "interval" ? Number(input.intervalMinutes || 0) : null,
    time_of_day: input.ruleType === "interval" ? null : input.timeOfDay || "12:00",
    weekdays: input.ruleType === "weekly" ? (Array.isArray(input.weekdays) ? input.weekdays : []) : [],
    timezone: input.timezone || DEFAULT_TIMEZONE,
    is_active: input.isActive !== false,
    created_at: getNowIso(),
    updated_at: getNowIso(),
    last_generated_at: null,
    generated_run_keys: [],
  };

  validateSchedule(schedule);
  workspace.schedules.unshift(schedule);
  appendTaskUpdate(workspace, taskId, "note", `Saved ${schedule.rule_type} schedule.`);
  materializeSchedules(workspace);
  writeWorkspace(workspace);
  return joinRelations(workspace).schedules.find((item) => item.id === schedule.id);
}

export {DEFAULT_TIMEZONE, WEEKDAY_OPTIONS};
