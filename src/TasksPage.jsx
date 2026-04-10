import {useEffect, useMemo, useState} from "react";
import {
  createTask,
  createTaskTemplate,
  deleteTask,
  deleteTaskTemplate,
  loadTasksWorkspace,
  saveTaskSchedule,
  updateTask,
  updateTaskTemplate,
} from "./tasksApi";
import {PRIORITY_LABELS, STATUS_LABELS, TASK_STATUS_ORDER} from "./tasksConfig";
import {subscribeToTasksWorkspaceChanges} from "./tasksRealtime";

const WEEKDAY_OPTIONS = [
  {value: "mon", label: "Mon"},
  {value: "tue", label: "Tue"},
  {value: "wed", label: "Wed"},
  {value: "thu", label: "Thu"},
  {value: "fri", label: "Fri"},
  {value: "sat", label: "Sat"},
  {value: "sun", label: "Sun"},
];

const SCHEDULE_STEP_MINUTES = 15;

function isQuarterHourTime(value) {
  const match = String(value || "").trim().match(/^(\d{2}):(\d{2})$/);
  if (!match) return false;
  return Number(match[2]) % SCHEDULE_STEP_MINUTES === 0;
}

const EMPTY_TASK_FORM = {
  title: "",
  description: "",
  ownerId: "",
  priority: "medium",
  templateId: "",
};

const EMPTY_TEMPLATE_FORM = {
  name: "",
  description: "",
  priority: "medium",
  checklistText: "",
};

const EMPTY_SCHEDULE_FORM = {
  ruleType: "none",
  timeOfDay: "12:00",
  intervalMinutes: "60",
  weekdays: ["mon", "wed", "fri"],
};

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function sortTasks(items) {
  return items.slice().sort((left, right) => {
    const leftTime = new Date(left.updated_at || left.created_at || 0).getTime();
    const rightTime = new Date(right.updated_at || right.created_at || 0).getTime();
    return rightTime - leftTime;
  });
}

function OwnerBadge({owner}) {
  if (!owner) return null;
  return (
    <span className={`owner-badge owner-${owner.color || "slate"}`}>
      <span className="owner-avatar">{owner.avatar || owner.name?.[0] || "?"}</span>
      {owner.name}
    </span>
  );
}

function ScheduleSummary({schedule}) {
  if (!schedule || !schedule.rule_type) return <span className="detail-muted">No schedule</span>;
  if (schedule.rule_type === "interval") {
    return <span className="detail-muted">Every {schedule.interval_minutes} min</span>;
  }
  if (schedule.rule_type === "weekly") {
    const labels = (schedule.weekdays || [])
      .map((weekday) => WEEKDAY_OPTIONS.find((item) => item.value === weekday)?.label || weekday)
      .join(", ");
    return <span className="detail-muted">{labels} · {schedule.time_of_day}</span>;
  }
  return <span className="detail-muted">Daily · {schedule.time_of_day}</span>;
}

function updateKindLabel(kind) {
  if (kind === "status_change") return "Status";
  if (kind === "progress") return "Progress";
  if (kind === "blocker") return "Blocker";
  if (kind === "done") return "Done";
  return "Note";
}

function getLatestTaskUpdate(task) {
  return Array.isArray(task?.updates) && task.updates.length > 0 ? task.updates[0] : null;
}

function TaskModal({task, owners, onClose, onSave, onDelete, saving, deleting}) {
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    if (!task) {
      setDraft(null);
      return;
    }
    setDraft({
      title: task.title || "",
      description: task.description || "",
      ownerId: task.owner_id || "",
      status: task.status || "todo",
      priority: task.priority || "medium",
      scheduleRuleType: task.schedule?.rule_type || "none",
      scheduleTimeOfDay: task.schedule?.time_of_day || "12:00",
      scheduleIntervalMinutes: String(task.schedule?.interval_minutes || 60),
      scheduleWeekdays: Array.isArray(task.schedule?.weekdays) && task.schedule.weekdays.length > 0
        ? task.schedule.weekdays
        : ["mon", "wed", "fri"],
    });
  }, [task]);

  if (!task || !draft) return null;

  const toggleWeekday = (weekday) => {
    setDraft((current) => ({
      ...current,
      scheduleWeekdays: current.scheduleWeekdays.includes(weekday)
        ? current.scheduleWeekdays.filter((item) => item !== weekday)
        : [...current.scheduleWeekdays, weekday],
    }));
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card detail-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="eyebrow">Task details</div>
            <h3>{task.title}</h3>
          </div>
          <button className="secondary" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="detail-modal-body">
          <div className="task-detail-meta-bar">
            <span className={`priority-pill priority-${task.priority}`}>{PRIORITY_LABELS[task.priority] || task.priority}</span>
            <span className="detail-meta-chip">{STATUS_LABELS[task.status] || task.status}</span>
            {task.updated_at ? <span className="detail-meta-chip">Updated {formatDateTime(task.updated_at)}</span> : null}
            {task.schedule?.rule_type ? <span className="detail-meta-chip"><ScheduleSummary schedule={task.schedule} /></span> : null}
          </div>

          <label>
            <span>Title</span>
            <input
              type="text"
              value={draft.title}
              onChange={(event) => setDraft((current) => ({...current, title: event.target.value}))}
            />
          </label>

          <label>
            <span>Description</span>
            <textarea
              rows={6}
              value={draft.description}
              onChange={(event) => setDraft((current) => ({...current, description: event.target.value}))}
            />
          </label>

          <div className="task-form-row">
            <label>
              <span>Owner</span>
              <select
                value={draft.ownerId}
                onChange={(event) => setDraft((current) => ({...current, ownerId: event.target.value}))}
              >
                <option value="">Unassigned</option>
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>Status</span>
              <select
                value={draft.status}
                onChange={(event) => setDraft((current) => ({...current, status: event.target.value}))}
              >
                {TASK_STATUS_ORDER.map((status) => (
                  <option key={status} value={status}>
                    {STATUS_LABELS[status]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="task-form-row">
            <label>
              <span>Priority</span>
              <select
                value={draft.priority}
                onChange={(event) => setDraft((current) => ({...current, priority: event.target.value}))}
              >
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <div className="schedule-summary-row">
              <span className="detail-label">Current schedule</span>
              <ScheduleSummary schedule={task.schedule} />
            </div>
          </div>

          <div className="detail-section">
            <div className="detail-section-header">
              <h4>Scheduling</h4>
            </div>

            <label>
              <span>Schedule</span>
              <select
                value={draft.scheduleRuleType}
                onChange={(event) => setDraft((current) => ({...current, scheduleRuleType: event.target.value}))}
              >
                <option value="none">No schedule</option>
                <option value="daily">Every day at a time</option>
                <option value="weekly">Given weekdays at a time</option>
                <option value="interval">Every X minutes</option>
              </select>
            </label>

            {draft.scheduleRuleType === "interval" ? (
              <label>
                <span>Interval minutes</span>
                <input
                  type="number"
                  min={String(SCHEDULE_STEP_MINUTES)}
                  step={String(SCHEDULE_STEP_MINUTES)}
                  value={draft.scheduleIntervalMinutes}
                  onChange={(event) =>
                    setDraft((current) => ({...current, scheduleIntervalMinutes: event.target.value}))
                  }
                />
              </label>
            ) : null}

            {draft.scheduleRuleType === "daily" || draft.scheduleRuleType === "weekly" ? (
              <label>
                <span>Time</span>
                <input
                  type="time"
                  step={String(SCHEDULE_STEP_MINUTES * 60)}
                  value={draft.scheduleTimeOfDay}
                  onChange={(event) =>
                    setDraft((current) => ({...current, scheduleTimeOfDay: event.target.value}))
                  }
                />
              </label>
            ) : null}

            {draft.scheduleRuleType === "weekly" ? (
              <div className="weekday-picker">
                {WEEKDAY_OPTIONS.map((weekday) => (
                  <button
                    key={weekday.value}
                    type="button"
                    className={draft.scheduleWeekdays.includes(weekday.value) ? "weekday-chip active" : "weekday-chip"}
                    onClick={() => toggleWeekday(weekday.value)}
                  >
                    {weekday.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <div className="detail-section">
            <div className="detail-section-header">
              <h4>Progress</h4>
            </div>
            <div className="task-updates-list">
              {Array.isArray(task.updates) && task.updates.length > 0 ? (
                task.updates.map((update) => (
                  <div key={update.id} className="task-update-item">
                    <div className="task-update-meta">
                      <span className="task-update-kind">{updateKindLabel(update.kind)}</span>
                      <span className="task-update-time">{formatDateTime(update.created_at)}</span>
                    </div>
                    <p>{update.message}</p>
                  </div>
                ))
              ) : (
                <p className="detail-muted">No progress updates yet.</p>
              )}
            </div>
          </div>
        </div>

        <div className="modal-actions split-actions">
          <button className="danger" type="button" disabled={saving || deleting} onClick={() => onDelete(task.id)}>
            {deleting ? "Deleting…" : "Delete task"}
          </button>
          <div className="modal-actions-group">
            <button className="secondary" type="button" onClick={onClose}>
              Cancel
            </button>
            <button
              className="primary"
              type="button"
              disabled={saving || deleting}
              onClick={() => onSave(task.id, draft)}
            >
              {saving ? "Saving…" : "Save task"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TemplateModal({template, onClose, onSave, onDelete, onUseTemplate, saving}) {
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    if (!template) {
      setDraft(null);
      return;
    }
    setDraft({
      name: template.name || "",
      description: template.description || "",
      priority: template.priority || "medium",
      checklistText: Array.isArray(template.checklist) ? template.checklist.join("\n") : "",
    });
  }, [template]);

  if (!template || !draft) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card detail-modal-card" onClick={(event) => event.stopPropagation()}>
        <div className="modal-header">
          <div>
            <div className="eyebrow">Template details</div>
            <h3>{template.name}</h3>
          </div>
          <button className="secondary" type="button" onClick={onClose}>
            Close
          </button>
        </div>

        <div className="detail-modal-body">
          <label>
            <span>Name</span>
            <input
              type="text"
              value={draft.name}
              onChange={(event) => setDraft((current) => ({...current, name: event.target.value}))}
            />
          </label>

          <label>
            <span>Description</span>
            <textarea
              rows={5}
              value={draft.description}
              onChange={(event) => setDraft((current) => ({...current, description: event.target.value}))}
            />
          </label>

          <label>
            <span>Checklist</span>
            <textarea
              rows={7}
              value={draft.checklistText}
              onChange={(event) => setDraft((current) => ({...current, checklistText: event.target.value}))}
              placeholder="One item per line"
            />
          </label>
        </div>

        <div className="modal-actions split-actions">
          <button className="danger" type="button" disabled={saving} onClick={() => onDelete(template.id)}>
            Delete template
          </button>
          <div className="modal-actions-group">
            <button className="secondary" type="button" onClick={() => onUseTemplate(template)}>
              Use template
            </button>
            <button
              className="primary"
              type="button"
              disabled={saving}
              onClick={() =>
                onSave(template.id, {
                  name: draft.name,
                  description: draft.description,
                  checklist: draft.checklistText
                    .split("\n")
                    .map((item) => item.trim())
                    .filter(Boolean),
                  priority: draft.priority,
                })
              }
            >
              {saving ? "Saving…" : "Save template"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TasksPage() {
  const [owners, setOwners] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creatingTask, setCreatingTask] = useState(false);
  const [creatingTemplate, setCreatingTemplate] = useState(false);
  const [savingTask, setSavingTask] = useState(false);
  const [deletingTask, setDeletingTask] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [error, setError] = useState("");
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showTemplatesOnly, setShowTemplatesOnly] = useState(false);
  const [showTemplateForm, setShowTemplateForm] = useState(false);
  const [selectedTaskId, setSelectedTaskId] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [draggingTaskId, setDraggingTaskId] = useState("");
  const [dragOverStatus, setDragOverStatus] = useState("");
  const [taskForm, setTaskForm] = useState(EMPTY_TASK_FORM);
  const [templateForm, setTemplateForm] = useState(EMPTY_TEMPLATE_FORM);

  const loadWorkspace = async ({silent = false} = {}) => {
    if (!silent) {
      setLoading(true);
      setError("");
    }
    try {
      const result = await loadTasksWorkspace();
      setOwners(result.owners || []);
      setTemplates(result.templates || []);
      setTasks(sortTasks(result.tasks || []));
    } catch (err) {
      if (!silent) {
        setError(err?.message || "Failed to load tasks.");
      }
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  };

  useEffect(() => {
    loadWorkspace();
  }, []);

  useEffect(() => {
    const shouldPauseLiveRefresh =
      showCreateModal
      || showTemplateForm
      || Boolean(selectedTaskId)
      || Boolean(selectedTemplateId)
      || savingTask
      || deletingTask
      || savingTemplate
      || creatingTask
      || creatingTemplate
      || Boolean(draggingTaskId);

    if (shouldPauseLiveRefresh) {
      return undefined;
    }

    let refreshTimeout = null;
    const unsubscribe = subscribeToTasksWorkspaceChanges(() => {
      if (document.hidden) return;
      window.clearTimeout(refreshTimeout);
      refreshTimeout = window.setTimeout(() => {
        loadWorkspace({silent: true});
      }, 150);
    });

    return () => {
      window.clearTimeout(refreshTimeout);
      unsubscribe?.();
    };
  }, [
    showCreateModal,
    showTemplateForm,
    selectedTaskId,
    selectedTemplateId,
    savingTask,
    deletingTask,
    savingTemplate,
    creatingTask,
    creatingTemplate,
    draggingTaskId,
  ]);

  useEffect(() => {
    if (!taskForm.ownerId && owners.length > 0) {
      setTaskForm((current) => ({...current, ownerId: owners[0].id}));
    }
  }, [owners, taskForm.ownerId]);

  const summary = useMemo(() => {
    const total = tasks.length;
    const doing = tasks.filter((task) => task.status === "doing").length;
    const done = tasks.filter((task) => task.status === "done").length;
    return [
      {label: "Total", value: total},
      {label: "Doing", value: doing},
      {label: "Done", value: done},
      {label: "Templates", value: templates.length},
    ];
  }, [tasks, templates.length]);

  const boardColumns = useMemo(
    () =>
      Object.fromEntries(
        TASK_STATUS_ORDER.map((status) => [status, sortTasks(tasks.filter((task) => task.status === status))]),
      ),
    [tasks],
  );

  const selectedTask = tasks.find((task) => task.id === selectedTaskId) || null;
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId) || null;

  const openCreateTaskModal = (template = null) => {
    setTaskForm({
      title: template?.name || "",
      description: template?.description || "",
      ownerId: owners[0]?.id || "",
      priority: template?.priority || "medium",
      templateId: template?.id || "",
    });
    setShowCreateModal(true);
  };

  const handleCreateTask = async (event) => {
    event.preventDefault();
    if (!taskForm.title.trim()) {
      setError("Task title is required.");
      return;
    }

    setCreatingTask(true);
    setError("");
    try {
      const task = await createTask({
        title: taskForm.title.trim(),
        description: taskForm.description.trim(),
        ownerId: taskForm.ownerId || null,
        priority: taskForm.priority,
        templateId: taskForm.templateId || null,
        status: "todo",
      });
      setTasks((current) => sortTasks([task, ...current]));
      setTaskForm({...EMPTY_TASK_FORM, ownerId: owners[0]?.id || ""});
      setShowCreateModal(false);
    } catch (err) {
      setError(err?.message || "Failed to create task.");
    } finally {
      setCreatingTask(false);
    }
  };

  const handleCreateTemplate = async (event) => {
    event.preventDefault();
    if (!templateForm.name.trim()) {
      setError("Template name is required.");
      return;
    }

    setCreatingTemplate(true);
    setError("");
    try {
      const template = await createTaskTemplate({
        name: templateForm.name.trim(),
        description: templateForm.description.trim(),
        priority: templateForm.priority,
        checklist: templateForm.checklistText
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
      });
      setTemplates((current) => [template, ...current].sort((a, b) => a.name.localeCompare(b.name)));
      setTemplateForm(EMPTY_TEMPLATE_FORM);
      setShowTemplateForm(false);
    } catch (err) {
      setError(err?.message || "Failed to create template.");
    } finally {
      setCreatingTemplate(false);
    }
  };

  const handleSaveTask = async (taskId, draft) => {
    setSavingTask(true);
    setError("");
    try {
      if (
        draft.scheduleRuleType === "interval"
        && Number(draft.scheduleIntervalMinutes || 0) % SCHEDULE_STEP_MINUTES !== 0
      ) {
        throw new Error(`Interval schedule must be in ${SCHEDULE_STEP_MINUTES}-minute increments.`);
      }
      if (
        ["daily", "weekly"].includes(draft.scheduleRuleType)
        && !isQuarterHourTime(draft.scheduleTimeOfDay)
      ) {
        throw new Error(
          `Scheduled time must be on a ${SCHEDULE_STEP_MINUTES}-minute boundary (00, 15, 30, 45).`,
        );
      }

      await updateTask(taskId, {
        title: draft.title,
        description: draft.description,
        ownerId: draft.ownerId || null,
        priority: draft.priority,
        status: draft.status,
      });
      await saveTaskSchedule(taskId, {
        ruleType: draft.scheduleRuleType,
        timeOfDay: draft.scheduleTimeOfDay,
        intervalMinutes: Number(draft.scheduleIntervalMinutes || 0),
        weekdays: draft.scheduleWeekdays,
        ownerId: draft.ownerId || null,
        priority: draft.priority,
      });
      const refreshed = await loadTasksWorkspace();
      setOwners(refreshed.owners || []);
      setTemplates(refreshed.templates || []);
      setTasks(sortTasks(refreshed.tasks || []));
      setSelectedTaskId(taskId);
    } catch (err) {
      setError(err?.message || "Failed to save task.");
    } finally {
      setSavingTask(false);
    }
  };

  const handleDeleteTask = async (taskId) => {
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    if (!window.confirm(`Delete task "${task.title}"?`)) {
      return;
    }

    setDeletingTask(true);
    setError("");
    try {
      await deleteTask(taskId);
      setTasks((current) => current.filter((item) => item.id !== taskId));
      setSelectedTaskId("");
    } catch (err) {
      setError(err?.message || "Failed to delete task.");
    } finally {
      setDeletingTask(false);
    }
  };

  const handleSaveTemplate = async (templateId, patch) => {
    setSavingTemplate(true);
    setError("");
    try {
      const updated = await updateTaskTemplate(templateId, patch);
      setTemplates((current) => current.map((template) => (template.id === templateId ? updated : template)));
      setSelectedTemplateId(templateId);
    } catch (err) {
      setError(err?.message || "Failed to save template.");
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDeleteTemplate = async (templateId) => {
    setSavingTemplate(true);
    setError("");
    try {
      await deleteTaskTemplate(templateId);
      setTemplates((current) => current.filter((template) => template.id !== templateId));
      setTasks((current) => current.map((task) => (task.template_id === templateId ? {...task, template: null, template_id: null} : task)));
      setSelectedTemplateId("");
    } catch (err) {
      setError(err?.message || "Failed to delete template.");
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleDropToStatus = async (event, status) => {
    event.preventDefault();
    const taskId = draggingTaskId || event.dataTransfer.getData("text/plain");
    setDragOverStatus("");
    setDraggingTaskId("");
    if (!taskId) return;
    const task = tasks.find((item) => item.id === taskId);
    if (!task || task.status === status) return;
    try {
      const updatedTask = await updateTask(task.id, {status});
      setTasks((current) => sortTasks(current.map((item) => (item.id === task.id ? updatedTask : item))));
    } catch (err) {
      setError(err?.message || "Failed to move task.");
    }
  };

  return (
    <div className="tasks-page">
      <section className="tasks-header-panel">
        <div>
          <div className="eyebrow">Task control</div>
          <h2>{showTemplatesOnly ? "Templates" : "Tasks"}</h2>
        </div>
        <div className="tasks-hero-meta">
          <button className="secondary" type="button" onClick={() => setShowTemplatesOnly((value) => !value)}>
            {showTemplatesOnly ? "Back to tasks" : "Templates"}
          </button>
          {!showTemplatesOnly ? (
            <button className="primary" type="button" onClick={() => openCreateTaskModal(null)}>
              Add task
            </button>
          ) : null}
        </div>
      </section>

      <section className="tasks-summary-strip">
        {summary.map((item, index) => (
          <div key={item.label} className="summary-item">
            <span className="summary-value">{item.value}</span>
            <span className="summary-label">{item.label}</span>
            {index < summary.length - 1 ? <span className="summary-divider" /> : null}
          </div>
        ))}
      </section>

      {error ? (
        <section className="card status-card">
          <p className="error">{error}</p>
        </section>
      ) : null}

      {showTemplatesOnly ? (
        <section className="templates-view">
          <div className="templates-toolbar">
            <div>
              <div className="eyebrow">Reusable templates</div>
              <h3>Templates</h3>
            </div>
            <button className="secondary" type="button" onClick={() => setShowTemplateForm((value) => !value)}>
              {showTemplateForm ? "Hide form" : "New template"}
            </button>
          </div>

          {showTemplateForm ? (
            <form className="template-inline-form card" onSubmit={handleCreateTemplate}>
              <label>
                <span>Name</span>
                <input
                  type="text"
                  value={templateForm.name}
                  onChange={(event) => setTemplateForm((current) => ({...current, name: event.target.value}))}
                />
              </label>

              <label>
                <span>Description</span>
                <textarea
                  rows={4}
                  value={templateForm.description}
                  onChange={(event) => setTemplateForm((current) => ({...current, description: event.target.value}))}
                />
              </label>

              <label>
                <span>Checklist</span>
                <textarea
                  rows={5}
                  value={templateForm.checklistText}
                  onChange={(event) => setTemplateForm((current) => ({...current, checklistText: event.target.value}))}
                  placeholder="One item per line"
                />
              </label>

              <div className="template-inline-form-actions">
                <button className="primary" type="submit" disabled={creatingTemplate}>
                  {creatingTemplate ? "Saving…" : "Create template"}
                </button>
              </div>
            </form>
          ) : null}

          <div className="templates-inline-grid">
            {templates
              .slice()
              .sort((a, b) => a.name.localeCompare(b.name))
              .map((template) => (
                <article
                  key={template.id}
                  className="task-card minimal-task-card template-task-card"
                  onClick={() => setSelectedTemplateId(template.id)}
                >
                  <div className="task-card-header compact-task-card-header">
                    <h4>{template.name}</h4>
                    <span className={`priority-pill priority-${template.priority}`}>
                      {PRIORITY_LABELS[template.priority] || template.priority}
                    </span>
                  </div>
                  <div className="minimal-task-footer template-footer">
                    <span className="detail-muted">
                      {Array.isArray(template.checklist) ? template.checklist.length : 0} checklist item(s)
                    </span>
                  </div>
                </article>
              ))}
          </div>
        </section>
      ) : (
        <section className="tasks-board-fullwidth">
          {TASK_STATUS_ORDER.map((status) => (
            <section
              key={status}
              className={`task-column ${draggingTaskId ? "task-column-droppable" : ""} ${dragOverStatus === status ? "task-column-active" : ""}`}
              onDragOver={(event) => {
                event.preventDefault();
                setDragOverStatus(status);
              }}
              onDragLeave={() => setDragOverStatus("")}
              onDrop={(event) => handleDropToStatus(event, status)}
            >
              <div className="task-column-header">
                <h3>{STATUS_LABELS[status]}</h3>
              </div>

              <div className="task-column-body">
                {loading ? (
                  <p className="muted">Loading tasks…</p>
                ) : boardColumns[status].length === 0 ? null : (
                  boardColumns[status].map((task) => (
                    <article
                      key={task.id}
                      className={`task-card minimal-task-card ${draggingTaskId === task.id ? "task-card-dragging" : ""}`}
                      draggable
                      onClick={() => setSelectedTaskId(task.id)}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", task.id);
                        setDraggingTaskId(task.id);
                      }}
                      onDragEnd={() => {
                        setDraggingTaskId("");
                        setDragOverStatus("");
                      }}
                    >
                      <div className="task-card-header compact-task-card-header">
                        <h4>{task.title}</h4>
                        <span className={`priority-pill priority-${task.priority}`}>
                          {PRIORITY_LABELS[task.priority] || task.priority}
                        </span>
                      </div>
                      {getLatestTaskUpdate(task) ? (
                        <p className="task-card-update-preview">{getLatestTaskUpdate(task).message}</p>
                      ) : null}
                      <div className="minimal-task-footer minimal-task-footer-top">
                        <OwnerBadge owner={task.owner} />
                        {task.schedule?.rule_type ? <ScheduleSummary schedule={task.schedule} /> : null}
                      </div>
                      <div className="minimal-task-footer">
                        <span className="task-update-count">
                          {Array.isArray(task.updates) ? task.updates.length : 0} update{Array.isArray(task.updates) && task.updates.length === 1 ? "" : "s"}
                        </span>
                        {task.updated_at ? <span className="task-updated">{formatDateTime(task.updated_at)}</span> : null}
                      </div>
                    </article>
                  ))
                )}
              </div>
            </section>
          ))}
        </section>
      )}

      {showCreateModal ? (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div>
                <div className="eyebrow">New task</div>
                <h3>Create task</h3>
              </div>
              <button className="secondary" type="button" onClick={() => setShowCreateModal(false)}>
                Close
              </button>
            </div>

            <form className="task-modal-form" onSubmit={handleCreateTask}>
              <label>
                <span>Title</span>
                <input
                  type="text"
                  value={taskForm.title}
                  onChange={(event) => setTaskForm((current) => ({...current, title: event.target.value}))}
                />
              </label>

              <label>
                <span>Description</span>
                <textarea
                  rows={6}
                  value={taskForm.description}
                  onChange={(event) => setTaskForm((current) => ({...current, description: event.target.value}))}
                />
              </label>

              <div className="task-form-row">
                <label>
                  <span>Owner</span>
                  <select
                    value={taskForm.ownerId}
                    onChange={(event) => setTaskForm((current) => ({...current, ownerId: event.target.value}))}
                  >
                    {owners.map((owner) => (
                      <option key={owner.id} value={owner.id}>
                        {owner.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  <span>Priority</span>
                  <select
                    value={taskForm.priority}
                    onChange={(event) => setTaskForm((current) => ({...current, priority: event.target.value}))}
                  >
                    {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="modal-actions">
                <button className="secondary" type="button" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button className="primary" type="submit" disabled={creatingTask}>
                  {creatingTask ? "Creating…" : "Create task"}
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}

      <TaskModal
        task={selectedTask}
        owners={owners}
        onClose={() => setSelectedTaskId("")}
        onSave={handleSaveTask}
        onDelete={handleDeleteTask}
        saving={savingTask}
        deleting={deletingTask}
      />

      <TemplateModal
        template={selectedTemplate}
        onClose={() => setSelectedTemplateId("")}
        onSave={handleSaveTemplate}
        onDelete={handleDeleteTemplate}
        onUseTemplate={(template) => {
          setSelectedTemplateId("");
          openCreateTaskModal(template);
        }}
        saving={savingTemplate}
      />
    </div>
  );
}
