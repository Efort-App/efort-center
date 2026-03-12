import {httpsCallable} from "firebase/functions";
import {firebaseInitError, functions} from "./firebase";
import {
  createMockTask,
  createMockTaskFromTemplate,
  createMockTemplate,
  deleteMockTemplate,
  loadMockWorkspace,
  saveMockTaskSchedule,
  updateMockTask,
  updateMockTemplate,
} from "./tasksMockApi";

const TASKS_BACKEND = import.meta.env.VITE_TASKS_BACKEND || "firebase";

function isFirebaseBackend() {
  return TASKS_BACKEND === "firebase";
}

function assertFunctionsReady() {
  if (!functions) {
    throw new Error(firebaseInitError || "Firebase Functions is not initialized.");
  }
}

async function firebaseCall(name, payload = {}) {
  assertFunctionsReady();
  const callable = httpsCallable(functions, name);
  const response = await callable(payload);
  return response?.data || {};
}

export async function loadTasksWorkspace() {
  if (!isFirebaseBackend()) {
    return loadMockWorkspace();
  }

  const [ownersResult, tasksResult, templatesResult, schedulesResult] = await Promise.all([
    firebaseCall("listTaskOwners"),
    firebaseCall("listTasks"),
    firebaseCall("listTaskTemplates"),
    firebaseCall("listTaskSchedules"),
  ]);

  return {
    owners: Array.isArray(ownersResult.owners) ? ownersResult.owners : [],
    tasks: Array.isArray(tasksResult.tasks) ? tasksResult.tasks : [],
    templates: Array.isArray(templatesResult.templates) ? templatesResult.templates : [],
    schedules: Array.isArray(schedulesResult.schedules) ? schedulesResult.schedules : [],
  };
}

export async function createTask(input) {
  if (!isFirebaseBackend()) {
    return createMockTask(input);
  }

  const result = await firebaseCall("createTask", input);
  return result.task;
}

export async function updateTask(taskId, patch) {
  if (!isFirebaseBackend()) {
    return updateMockTask(taskId, patch);
  }

  const result = await firebaseCall("updateTask", {taskId, patch});
  return result.task;
}

export async function saveTaskSchedule(taskId, input) {
  if (!isFirebaseBackend()) {
    return saveMockTaskSchedule(taskId, input);
  }

  const result = await firebaseCall("saveTaskSchedule", {taskId, schedule: input});
  return result.schedule;
}

export async function createTaskFromTemplate(templateId, overrides = {}) {
  if (!isFirebaseBackend()) {
    return createMockTaskFromTemplate(templateId, overrides);
  }

  const result = await firebaseCall("createTaskFromTemplate", {templateId, overrides});
  return result.task;
}

export async function createTaskTemplate(input) {
  if (!isFirebaseBackend()) {
    return createMockTemplate(input);
  }

  const result = await firebaseCall("createTaskTemplate", input);
  return result.template;
}

export async function updateTaskTemplate(templateId, patch) {
  if (!isFirebaseBackend()) {
    return updateMockTemplate(templateId, patch);
  }

  const result = await firebaseCall("updateTaskTemplate", {templateId, patch});
  return result.template;
}

export async function deleteTaskTemplate(templateId) {
  if (!isFirebaseBackend()) {
    return deleteMockTemplate(templateId);
  }

  return firebaseCall("deleteTaskTemplate", {templateId});
}

export function getTasksBackend() {
  return TASKS_BACKEND;
}
