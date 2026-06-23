#!/usr/bin/env node

import { Command } from 'commander';
import dotenv from 'dotenv';

import { registerRun } from './commands/run.js';
import { registerAccount } from './commands/account.js';
import { registerAuth } from './commands/auth.js';
import { registerHistory } from './commands/history.js';
import { registerDelete } from './commands/delete.js';

dotenv.config();

const program = new Command();

program
  .name('github-social-bot')
  .description('AI-powered CLI bot that turns Git commits into social posts on Twitter (X) and Bluesky using Gemini AI')
  .version('2.0.0');

// Register all command groups
registerRun(program);
registerAccount(program);
registerAuth(program);
registerHistory(program);
registerDelete(program);

program.parse(process.argv);
