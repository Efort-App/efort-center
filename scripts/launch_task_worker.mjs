#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const workerPath = path.join(here, 'run_task_worker.mjs');

const child = spawn(process.execPath, [workerPath], {
  detached: true,
  stdio: 'ignore',
  env: process.env,
});

child.unref();
