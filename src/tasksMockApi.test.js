import assert from "node:assert/strict";
import {beforeEach, describe, it} from "node:test";
import {deleteMockTask, loadMockWorkspace} from "./tasksMockApi.js";

const STORAGE_KEY = "efort-center.tasks.workspace.v5";

function createLocalStorage() {
  const store = new Map();
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
}

beforeEach(() => {
  global.window = {localStorage: createLocalStorage()};
});

describe("deleteMockTask", () => {
  it("removes the task and its task-scoped schedules and updates", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        owners: [{id: "owner-1", name: "Ben", slug: "ben", kind: "agent"}],
        templates: [{id: "template-1", name: "Template", description: "", priority: "medium", checklist: []}],
        tasks: [
          {
            id: "task-delete",
            title: "Delete me",
            description: "",
            status: "todo",
            priority: "medium",
            owner_id: "owner-1",
            template_id: null,
            created_at: "2026-03-11T09:00:00.000Z",
            updated_at: "2026-03-11T09:00:00.000Z",
          },
          {
            id: "task-keep",
            title: "Keep me",
            description: "",
            status: "doing",
            priority: "high",
            owner_id: "owner-1",
            template_id: "template-1",
            created_at: "2026-03-11T10:00:00.000Z",
            updated_at: "2026-03-11T10:00:00.000Z",
          },
        ],
        task_updates: [
          {id: "update-delete", task_id: "task-delete", kind: "note", message: "to remove", created_at: "2026-03-11T09:05:00.000Z"},
          {id: "update-keep", task_id: "task-keep", kind: "note", message: "to keep", created_at: "2026-03-11T10:05:00.000Z"},
        ],
        schedules: [
          {
            id: "schedule-delete",
            name: "Delete schedule",
            template_id: null,
            source_task_id: "task-delete",
            owner_id: "owner-1",
            priority: "medium",
            rule_type: "daily",
            interval_minutes: null,
            time_of_day: "12:00",
            weekdays: [],
            timezone: "Europe/Madrid",
            is_active: false,
            created_at: "2026-03-11T09:00:00.000Z",
            updated_at: "2026-03-11T09:00:00.000Z",
            last_generated_at: null,
            generated_run_keys: [],
          },
          {
            id: "schedule-keep",
            name: "Keep schedule",
            template_id: "template-1",
            source_task_id: null,
            owner_id: "owner-1",
            priority: "medium",
            rule_type: "daily",
            interval_minutes: null,
            time_of_day: "12:00",
            weekdays: [],
            timezone: "Europe/Madrid",
            is_active: false,
            created_at: "2026-03-11T09:00:00.000Z",
            updated_at: "2026-03-11T09:00:00.000Z",
            last_generated_at: null,
            generated_run_keys: [],
          },
        ],
      }),
    );

    await deleteMockTask("task-delete");

    const workspace = JSON.parse(window.localStorage.getItem(STORAGE_KEY));
    const joined = await loadMockWorkspace();

    assert.equal(workspace.tasks.some((task) => task.id === "task-delete"), false);
    assert.equal(workspace.task_updates.some((update) => update.task_id === "task-delete"), false);
    assert.equal(workspace.schedules.some((schedule) => schedule.source_task_id === "task-delete"), false);
    assert.equal(joined.tasks.some((task) => task.id === "task-keep"), true);
    assert.equal(joined.schedules.some((schedule) => schedule.id === "schedule-keep"), true);
  });
});
