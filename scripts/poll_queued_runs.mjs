#!/usr/bin/env node
import os from 'node:os';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENCLAW_AGENT = (process.env.OPENCLAW_AGENT || 'ben').toLowerCase();
const MACHINE_NAME = process.env.EFORT_MACHINE_NAME || os.hostname();
const EFORT_OPENCLAW_LAUNCH_CMD = process.env.EFORT_OPENCLAW_LAUNCH_CMD || '';

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function buildTaskPrompt(run) {
  const parts = [
    `You are assigned to Efort Center task run ${run.task_run_id}.`,
    `Task title: ${run.title}`,
    run.description ? `Task description: ${run.description}` : null,
    `Agent slug: ${run.agent_slug}`,
    `Task ID: ${run.task_id}`,
    `Run ID: ${run.task_run_id}`,
    `When working, send only semantic progress updates (start, step changes, blockers, done).`,
  ].filter(Boolean);
  return parts.join('\n');
}

function execShellCommand(command, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, {
      shell: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        ...env,
      },
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
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
      } else {
        reject(new Error(`Command failed (${code}): ${stderr || stdout}`));
      }
    });
  });
}

async function reportRunUpdate(taskRunId, payload) {
  const { error } = await supabase.from('task_run_updates').insert({
    task_run_id: taskRunId,
    kind: payload.kind || 'system',
    status: payload.status || null,
    progress_percent: payload.progress_percent ?? null,
    current_step: payload.current_step || null,
    message: payload.message,
    metadata: payload.metadata || {},
  });
  if (error) throw error;
}

async function triggerOpenClaw(run) {
  const prompt = buildTaskPrompt(run);

  if (!EFORT_OPENCLAW_LAUNCH_CMD) {
    throw new Error(
      'EFORT_OPENCLAW_LAUNCH_CMD is not set. Configure the local OpenClaw launch command first.',
    );
  }

  const result = await execShellCommand(EFORT_OPENCLAW_LAUNCH_CMD, {
    EFORT_TASK_RUN_ID: run.task_run_id,
    EFORT_TASK_ID: run.task_id,
    EFORT_SCHEDULE_ID: run.schedule_id || '',
    EFORT_AGENT_SLUG: run.agent_slug,
    EFORT_TASK_TITLE: run.title,
    EFORT_TASK_DESCRIPTION: run.description || '',
    EFORT_TASK_PROMPT: prompt,
    EFORT_MACHINE_NAME: MACHINE_NAME,
  });

  return {
    currentStep: 'Claimed by local worker',
    message: `Run claimed on ${MACHINE_NAME} for agent ${run.agent_slug}.`,
    metadata: {
      machine_name: MACHINE_NAME,
      launch_stdout: result.stdout || null,
      launch_stderr: result.stderr || null,
    },
  };
}

async function main() {
  const { data: runs, error } = await supabase.rpc('claim_next_queued_task_runs', {
    p_agent_slug: OPENCLAW_AGENT,
    p_machine_name: MACHINE_NAME,
    p_limit: 5,
  });

  if (error) throw error;

  if (!runs || runs.length === 0) {
    console.log('No queued runs.');
    return;
  }

  for (const run of runs) {
    try {
      const launch = await triggerOpenClaw(run);

      const { error: updateError } = await supabase
        .from('task_runs')
        .update({
          status: 'running',
          current_step: launch.currentStep,
          latest_update: launch.message,
          last_heartbeat_at: new Date().toISOString(),
        })
        .eq('id', run.task_run_id);

      if (updateError) throw updateError;

      await reportRunUpdate(run.task_run_id, {
        kind: 'status_change',
        status: 'running',
        current_step: launch.currentStep,
        message: launch.message,
        metadata: launch.metadata,
      });
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : String(runError);
      await supabase
        .from('task_runs')
        .update({
          status: 'failed',
          latest_update: message,
          finished_at: new Date().toISOString(),
        })
        .eq('id', run.task_run_id);

      await reportRunUpdate(run.task_run_id, {
        kind: 'system',
        status: 'failed',
        message,
      });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
