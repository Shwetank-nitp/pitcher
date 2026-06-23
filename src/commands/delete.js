import prompts from 'prompts';
import picocolors from 'picocolors';
import ora from 'ora';

import {
  loadConfig,
  saveHistory,
  clearAllData,
  getLastUsed
} from '../storage.js';

import { deleteTwitterTweet } from '../twitter.js';
import { deleteBlueskyPost } from '../bluesky.js';
import { pickAccount } from '../helpers.js';

/**
 * Registers the `delete` command group and the `kill` command on the program.
 */
export function registerDelete(program) {

  // ── delete group ───────────────────────────────────────────────────────────
  const deleteCmd = program.command('delete').description('Delete posts or logs');

  deleteCmd
    .command('logs')
    .description('Wipe all local history logs (accounts and repos are kept)')
    .action(async () => {
      const res = await prompts({
        type: 'confirm',
        name: 'value',
        message: 'Delete ALL local history and logs? (accounts/repos are kept)',
        initial: false
      });
      if (res.value) {
        saveHistory([]);
        console.log(picocolors.green('✔ All history logs cleared.'));
      } else {
        console.log('Cancelled.');
      }
    });

  deleteCmd
    .command('post <post_id>')
    .description('Delete a post by ID/URI (works for both Twitter and Bluesky)')
    .action(async (postId) => {
      const config = loadConfig();
      const account = await pickAccount(config, getLastUsed(config).account);
      const platform = account.platform || 'twitter';

      const spinner = ora('Deleting post...').start();
      try {
        if (platform === 'bluesky') {
          const { accessJwt, did } = account.bluesky || {};
          if (!accessJwt || !did) {
            spinner.fail(`Account "${account.name}" is not linked to Bluesky. Run "login" first.`);
            process.exit(1);
          }
          await deleteBlueskyPost(accessJwt, did, postId);
          spinner.succeed(picocolors.green('✔ Bluesky post deleted.'));
        } else {
          const accessToken = account.twitter?.accessToken;
          if (!accessToken) {
            spinner.fail(`Account "${account.name}" is not linked to Twitter. Run "login" first.`);
            process.exit(1);
          }
          await deleteTwitterTweet(accessToken, postId);
          spinner.succeed(picocolors.green('✔ Tweet deleted.'));
        }
      } catch (err) {
        spinner.fail(`Deletion failed: ${err.message}`); process.exit(1);
      }
    });

  // ── kill ───────────────────────────────────────────────────────────────────
  program
    .command('kill')
    .description('Permanently wipe ALL local data (accounts, repos, history, config)')
    .action(async () => {
      const res = await prompts({
        type: 'confirm',
        name: 'value',
        message: 'Permanently delete ALL data — accounts, repositories, history, and config?',
        initial: false
      });
      if (res.value) {
        clearAllData();
        console.log(picocolors.green('✔ All data wiped.'));
      } else {
        console.log('Cancelled.');
      }
    });
}
