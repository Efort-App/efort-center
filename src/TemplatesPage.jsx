import {useEffect, useMemo, useState} from "react";
import {
  createTaskFromTemplate,
  createTaskTemplate,
  getTasksBackend,
  loadTasksWorkspace,
} from "./tasksApi";
import {PRIORITY_LABELS} from "./tasksConfig";

const EMPTY_TEMPLATE_FORM = {
  name: "",
  description: "",
  ownerId: "",
  priority: "medium",
  checklistText: "",
};

function OwnerBadge({owner}) {
  if (!owner) return <span className="owner-badge owner-muted">No default owner</span>;
  return (
    <span className={`owner-badge owner-${owner.color || "slate"}`}>
      <span className="owner-avatar">{owner.avatar || owner.name?.[0] || "?"}</span>
      {owner.name}
    </span>
  );
}

export default function TemplatesPage({onOpenTasks}) {
  const [owners, setOwners] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [creatingTaskId, setCreatingTaskId] = useState("");
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [form, setForm] = useState(EMPTY_TEMPLATE_FORM);

  const loadWorkspace = async () => {
    setLoading(true);
    setError("");

    try {
      const result = await loadTasksWorkspace();
      setOwners(result.owners || []);
      setTemplates(result.templates || []);
    } catch (err) {
      setError(err?.message || "Failed to load templates.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspace();
  }, []);

  useEffect(() => {
    if (!form.ownerId && owners.length > 0) {
      setForm((current) => ({...current, ownerId: owners[0].id}));
    }
  }, [owners, form.ownerId]);

  const backendLabel = getTasksBackend() === "mock" ? "Demo data" : "Firebase → Supabase";

  const sortedTemplates = useMemo(
    () => templates.slice().sort((left, right) => left.name.localeCompare(right.name)),
    [templates],
  );

  const handleCreateTemplate = async (event) => {
    event.preventDefault();
    if (!form.name.trim()) {
      setError("Template name is required.");
      return;
    }

    setCreating(true);
    setError("");
    setSuccess("");

    try {
      const template = await createTaskTemplate({
        name: form.name.trim(),
        description: form.description.trim(),
        ownerId: form.ownerId || null,
        priority: form.priority,
        checklist: form.checklistText
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean),
      });

      setTemplates((current) => [template, ...current]);
      setForm({
        ...EMPTY_TEMPLATE_FORM,
        ownerId: owners[0]?.id || "",
      });
      setSuccess(`Template “${template.name}” created.`);
    } catch (err) {
      setError(err?.message || "Failed to create template.");
    } finally {
      setCreating(false);
    }
  };

  const handleCreateTaskFromTemplate = async (templateId, templateName) => {
    setCreatingTaskId(templateId);
    setError("");
    setSuccess("");

    try {
      await createTaskFromTemplate(templateId);
      setSuccess(`Task created from “${templateName}”.`);
    } catch (err) {
      setError(err?.message || "Failed to create task from template.");
    } finally {
      setCreatingTaskId("");
    }
  };

  return (
    <div className="tasks-page">
      <section className="card tasks-hero">
        <div>
          <div className="eyebrow">Reusable workflows</div>
          <h2>Templates</h2>
          <p className="muted">
            Define repeatable task blueprints so new work is consistent and fast to assign.
          </p>
        </div>
        <div className="tasks-hero-meta">
          <span className="user-pill">{backendLabel}</span>
          <button className="secondary" onClick={loadWorkspace} disabled={loading}>
            {loading ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      </section>

      {(error || success) && (
        <section className={`card ${error ? "status-card" : "note-card"}`}>
          {error ? <p className="error">{error}</p> : <p>{success}</p>}
        </section>
      )}

      <section className="templates-layout">
        <form className="card task-form" onSubmit={handleCreateTemplate}>
          <div className="task-form-header">
            <div>
              <div className="eyebrow">New template</div>
              <h3>Build a reusable workflow</h3>
            </div>
          </div>

          <label>
            <span>Template name</span>
            <input
              type="text"
              value={form.name}
              onChange={(event) => setForm((current) => ({...current, name: event.target.value}))}
              placeholder="Example: Product QA review"
            />
          </label>

          <label>
            <span>Description</span>
            <textarea
              value={form.description}
              onChange={(event) =>
                setForm((current) => ({...current, description: event.target.value}))
              }
              placeholder="Explain what this workflow is for"
              rows={5}
            />
          </label>

          <div className="task-form-row">
            <label>
              <span>Default owner</span>
              <select
                value={form.ownerId}
                onChange={(event) => setForm((current) => ({...current, ownerId: event.target.value}))}
              >
                {owners.map((owner) => (
                  <option key={owner.id} value={owner.id}>
                    {owner.name}
                  </option>
                ))}
              </select>
            </label>

            <label>
              <span>Default priority</span>
              <select
                value={form.priority}
                onChange={(event) => setForm((current) => ({...current, priority: event.target.value}))}
              >
                {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <label>
            <span>Checklist items</span>
            <textarea
              value={form.checklistText}
              onChange={(event) =>
                setForm((current) => ({...current, checklistText: event.target.value}))
              }
              placeholder="One checklist item per line"
              rows={6}
            />
          </label>

          <button className="primary" type="submit" disabled={creating}>
            {creating ? "Saving…" : "Create template"}
          </button>
        </form>

        <div className="templates-grid">
          {sortedTemplates.map((template) => (
            <article key={template.id} className="card template-card">
              <div className="template-card-header">
                <div>
                  <h3>{template.name}</h3>
                  <p className="muted">{template.description}</p>
                </div>
                <span className={`priority-pill priority-${template.priority}`}>
                  {PRIORITY_LABELS[template.priority] || template.priority}
                </span>
              </div>

              <div className="task-card-meta">
                <OwnerBadge owner={template.owner} />
              </div>

              {template.checklist?.length ? (
                <ul className="template-checklist">
                  {template.checklist.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
              ) : (
                <p className="muted">No checklist items yet.</p>
              )}

              <div className="template-card-footer">
                <button
                  className="primary"
                  type="button"
                  disabled={creatingTaskId === template.id}
                  onClick={() => handleCreateTaskFromTemplate(template.id, template.name)}
                >
                  {creatingTaskId === template.id ? "Creating…" : "Create task from template"}
                </button>
                <button className="secondary" type="button" onClick={onOpenTasks}>
                  Open Tasks
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
