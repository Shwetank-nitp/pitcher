import prompts from 'prompts';
import picocolors from 'picocolors';
import ora from 'ora';

import {
  loadConfig,
  saveConfig,
  listAccounts,
  getAccount,
  saveAccount
} from '../storage.js';

import { loginBluesky } from '../bluesky.js';
import { startOAuthFlow } from '../oauth-helper.js';

/**
 * Registers the `login` and `logout` commands on the program.
 */
export function registerAuth(program) {

  // ── login ──────────────────────────────────────────────────────────────────
  program
    .command('login [accountName]')
    .description('Link an account to Twitter (OAuth) or Bluesky (App Password)')
    .action(async (accountNameArg) => {
      const config = loadConfig();
      const names = listAccounts(config);
      if (names.length === 0) {
        console.error(picocolors.red('✗ No accounts found. Run "account setup" first.')); process.exit(1);
      }

      let accountName = accountNameArg;
      if (!accountName) {
        if (names.length === 1) {
          accountName = names[0];
        } else {
          const res = await prompts({
            type: 'select',
            name: 'account',
            message: 'Login for which account?',
            choices: names.map(n => ({ title: n, value: n }))
          });
          if (!res.account) process.exit(0);
          accountName = res.account;
        }
      }

      const acc = getAccount(config, accountName);
      if (!acc) {
        console.error(picocolors.red(`✗ Account "${accountName}" not found.`)); process.exit(1);
      }
      const platform = acc.platform || 'twitter';

      if (platform === 'bluesky') {
        const bskyAnswers = await prompts([
          {
            type: 'text',
            name: 'handle',
            message: 'Bluesky handle (e.g. yourname.bsky.social):',
            initial: acc.bluesky?.identifier || '',
            validate: v => v ? true : 'Required.'
          },
          {
            type: 'password',
            name: 'appPassword',
            message: 'Bluesky App Password:',
            validate: v => v ? true : 'Required.'
          }
        ]);
        if (!bskyAnswers.handle || !bskyAnswers.appPassword) { console.log('Cancelled.'); return; }

        const spinner = ora('Authenticating with Bluesky...').start();
        try {
          const session = await loginBluesky(bskyAnswers.handle, bskyAnswers.appPassword);
          const freshConfig = loadConfig();
          const freshAcc = getAccount(freshConfig, accountName);
          freshAcc.bluesky = {
            identifier: bskyAnswers.handle,
            accessJwt: session.accessJwt,
            refreshJwt: session.refreshJwt,
            did: session.did,
            handle: session.handle
          };
          saveConfig(saveAccount(freshConfig, freshAcc));
          spinner.succeed(picocolors.green(`✔ Authenticated as @${session.handle}`));
        } catch (err) {
          spinner.fail(`Bluesky authentication failed: ${err.message}`);
          process.exit(1);
        }
      } else {
        try {
          await startOAuthFlow(accountName);
        } catch (err) {
          console.error(picocolors.red(`✗ Authentication failed: ${err.message}`));
          process.exit(1);
        }
      }
    });

  // ── logout ─────────────────────────────────────────────────────────────────
  program
    .command('logout [accountName]')
    .description('Clear stored credentials for an account')
    .action(async (accountNameArg) => {
      const config = loadConfig();
      const names = listAccounts(config);
      if (names.length === 0) {
        console.error(picocolors.red('✗ No accounts found.')); process.exit(1);
      }

      let accountName = accountNameArg;
      if (!accountName) {
        if (names.length === 1) {
          accountName = names[0];
        } else {
          const res = await prompts({
            type: 'select',
            name: 'account',
            message: 'Logout from which account?',
            choices: names.map(n => ({ title: n, value: n }))
          });
          if (!res.account) process.exit(0);
          accountName = res.account;
        }
      }

      const acc = getAccount(config, accountName);
      if (!acc) { console.error(picocolors.red(`✗ Account "${accountName}" not found.`)); process.exit(1); }

      const platform = acc.platform || 'twitter';
      if (platform === 'bluesky') {
        if (!acc.bluesky) acc.bluesky = {};
        acc.bluesky.accessJwt = '';
        acc.bluesky.refreshJwt = '';
      } else {
        if (!acc.twitter) acc.twitter = {};
        acc.twitter.accessToken = '';
        acc.twitter.userId = '';
        acc.twitter.username = '';
      }
      saveConfig(saveAccount(config, acc));
      console.log(picocolors.green(`✔ Logged out "${accountName}" (${platform}). Credentials cleared.`));
    });
}
