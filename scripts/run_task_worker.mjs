#!/usr/bin/env node
import { spawn } from 'node:child_process';

const TASK_RUN_ID = process.env.EFORT_TASK_RUN_ID || '';
const TASK_ID = process.env.EFORT_TASK_ID || '';
const TASK_TITLE = process.env.EFORT_TASK_TITLE || 'Untitled task';
const TASK_DESCRIPTION = process.env.EFORT_TASK_DESCRIPTION || '';
const TASK_PROMPT = process.env.EFORT_TASK_PROMPT || '';
const MACHINE_NAME = process.env.EFORT_MACHINE_NAME || 'unknown-machine';
const REPORT_URL = process.env.REPORT_TASK_PROGRESS_URL || '';
const PROGRESS_TOKEN = process.env.OPENCLAW_PROGRESS_TOKEN || '';
const OPENCLAW_AGENT_ID = process.env.OPENCLAW_AGENT_ID || 'main';
const OPENCLAW_TIMEOUT_SECONDS = process.env.OPENCLAW_TIMEOUT_SECONDS || '900';
const OPENCLAW_BIN = process.env.OPENCLAW_BIN || 'openclaw';
const OPENCLAW_ENTRY = process.env.OPENCLAW_ENTRY || '';
const TASK_NOTIFY_CHANNEL = process.env.TASK_NOTIFY_CHANNEL || '';
const TASK_NOTIFY_TARGET = process.env.TASK_NOTIFY_TARGET || '';
const TASK_NOTIFY_ACCOUNT = process.env.TASK_NOTIFY_ACCOUNT || '';

function truncate(value, max = 4000) {
  const text = String(value || '');
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function postUpdate(payload) {
  if (!REPORT_URL || !TASK_RUN_ID) return;
  const response = await fetch(REPORT_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(PROGRESS_TOKEN ? { Authorization: `Bearer ${PROGRESS_TOKEN}` } : {}),
    },
    body: JSON.stringify({ taskRunId: TASK_RUN_ID, ...payload }),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`report-task-progress failed (${response.status}): ${text}`);
  }
}

function execCommand(command, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({ code: code ?? 1, stdout: stdout.trim(), stderr: stderr.trim() });
    });
  });
}

function buildMessage() {
  const extra = [
    'Complete the task if possible from the current machine/tooling.',
    'If blocked, explain the blocker briefly and concretely.',
    'Reply with a concise execution summary only.',
  ].join('\n');

  return [
    TASK_PROMPT,
    TASK_DESCRIPTION ? `\nOriginal description:\n${TASK_DESCRIPTION}` : '',
    `\nMachine: ${MACHINE_NAME}`,
    `Task title: ${TASK_TITLE}`,
    `Task ID: ${TASK_ID}`,
    `Task run ID: ${TASK_RUN_ID}`,
    `\n${extra}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildNotificationMessage(status, summary) {
  const icon = status === 'done' ? '✅' : '❌';
  const statusLabel = status === 'done' ? 'Completed' : 'Failed';
  return [
    `${icon} Efort Center task ${statusLabel}`,
    `Task: ${TASK_TITLE}`,
    `Status: ${status}`,
    `Machine: ${MACHINE_NAME}`,
    '',
    truncate(summary, 3000),
  ].join('\n');
}

async function sendCompletionNotification(status, summary) {
  if (!TASK_NOTIFY_CHANNEL || !TASK_NOTIFY_TARGET) return null;

  const args = [
    ...(OPENCLAW_ENTRY ? [OPENCLAW_ENTRY] : []),
    'message',
    'send',
    '--json',
    '--channel',
    TASK_NOTIFY_CHANNEL,
    '--target',
    TASK_NOTIFY_TARGET,
    '--message',
    buildNotificationMessage(status, summary),
  ];

  if (TASK_NOTIFY_ACCOUNT) {
    args.push('--account', TASK_NOTIFY_ACCOUNT);
  }

  const result = await execCommand(OPENCLAW_BIN, args);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || 'Failed to send completion notification.');
  }

  try {
    return JSON.parse(result.stdout || '{}');
  } catch {
    return { raw: truncate(result.stdout, 2000) };
  }
}

async function main() {
  if (!TASK_RUN_ID) {
    throw new Error('EFORT_TASK_RUN_ID is required.');
  }

  await postUpdate({
    status: 'running',
    kind: 'progress',
    currentStep: 'OpenClaw worker started',
    progressPercent: 10,
    message: `OpenClaw worker started on ${MACHINE_NAME}.`,
    metadata: { machine_name: MACHINE_NAME },
  });

  const openClawArgs = [
    ...(OPENCLAW_ENTRY ? [OPENCLAW_ENTRY] : []),
    'agent',
    '--local',
    '--agent',
    OPENCLAW_AGENT_ID,
    '--json',
    '--timeout',
    String(OPENCLAW_TIMEOUT_SECONDS),
    '--message',
    buildMessage(),
  ];

  const result = await execCommand(OPENCLAW_BIN, openClawArgs);

  const metadata = {
    machine_name: MACHINE_NAME,
    exit_code: result.code,
    stdout: truncate(result.stdout, 12000),
    stderr: truncate(result.stderr, 12000),
  };

  if (result.code === 0) {
    let summary = result.stdout || `Task completed on ${MACHINE_NAME}.`;
    try {
      const parsed = JSON.parse(result.stdout || '{}');
      const payloadTexts = Array.isArray(parsed?.payloads)
        ? parsed.payloads.map((item) => item?.text).filter(Boolean)
        : [];
      if (payloadTexts.length > 0) {
        summary = payloadTexts.join('\n\n');
      }
    } catch {
      // Keep raw stdout as summary.
    }

    await postUpdate({
      status: 'done',
      kind: 'status_change',
      currentStep: 'Completed',
      progressPercent: 100,
      message: truncate(summary, 4000),
      metadata,
    });

    try {
      const notification = await sendCompletionNotification('done', summary);
      if (notification) {
        await postUpdate({
          kind: 'note',
          status: 'done',
          currentStep: 'Notification sent',
          message: 'Completion summary sent to main Telegram chat.',
          metadata: notification,
        });
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
    }
    return;
  }

  const failureMessage = truncate(result.stderr || result.stdout || 'Task execution failed.', 4000);
  await postUpdate({
    status: 'failed',
    kind: 'blocker',
    currentStep: 'Failed',
    progressPercent: 100,
    message: failureMessage,
    metadata,
  });

  try {
    const notification = await sendCompletionNotification('failed', failureMessage);
    if (notification) {
      await postUpdate({
        kind: 'note',
        status: 'failed',
        currentStep: 'Notification sent',
        message: 'Failure summary sent to main Telegram chat.',
        metadata: notification,
      });
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exit(result.code || 1);
}

main().catch(async (error) => {
  const message = error instanceof Error ? error.message : String(error);
  try {
    await postUpdate({
      status: 'failed',
      kind: 'blocker',
      currentStep: 'Failed to start',
      progressPercent: 100,
      message: truncate(message, 4000),
      metadata: { machine_name: MACHINE_NAME },
    });
  } catch {
    // Ignore secondary reporting failures.
  }
  console.error(message);
  process.exit(1);
});
