import prompts from 'prompts';
import picocolors from 'picocolors';
import boxen from 'boxen';
import ora from 'ora';

import {
  loadConfig,
  saveConfig,
  listAccounts,
  getAccount,
  saveAccount,
  deleteAccount,
  listRepositories,
  getRepository,
  saveRepository,
  deleteRepository,
  getLastUsed
} from '../storage.js';

import { isGitRepository } from '../github.js';
import { getTwitterUserId } from '../twitter.js';
import { loginBluesky } from '../bluesky.js';
import { ensureGlobalTwitter } from '../helpers.js';

/**
 * Registers all `account` sub-commands (including `account repo`) on the program.
 */
export function registerAccount(program) {
  const account = program
    .command('account')
    .description('Manage social accounts (Twitter/Bluesky) and their repositories');

  // ── Global Twitter credentials ─────────────────────────────────────────────
  account
    .command('setup-global')
    .description('Configure global Twitter Developer App credentials (Client ID + Secret)')
    .action(async () => {
      console.log(picocolors.cyan('--- Configure Global Twitter Developer App ---'));
      const config = loadConfig();
      const answers = await prompts([
        {
          type: 'text',
          name: 'clientId',
          message: 'Twitter Client ID:',
          initial: config.global?.twitter?.clientId || '',
          validate: v => v ? true : 'Required.'
        },
        {
          type: 'password',
          name: 'clientSecret',
          message: 'Twitter Client Secret:',
          initial: config.global?.twitter?.clientSecret || '',
          validate: v => v ? true : 'Required.'
        }
      ]);
      if (!answers.clientId || !answers.clientSecret) {
        console.log(picocolors.red('Aborted.')); process.exit(1);
      }
      config.global.twitter = { clientId: answers.clientId, clientSecret: answers.clientSecret };
      saveConfig(config);
      console.log(picocolors.green('✔ Global Twitter credentials saved!'));
    });

  // ── Global Gemini API key ──────────────────────────────────────────────────
  account
    .command('setup-global-gemini')
    .description('Configure global Gemini API Key')
    .action(async () => {
      console.log(picocolors.cyan('--- Configure Global Gemini API Key ---'));
      const config = loadConfig();
      const answers = await prompts([
        {
          type: 'password',
          name: 'geminiApiKey',
          message: 'Gemini API Key:',
          initial: config.global?.geminiApiKey || '',
          validate: v => v ? true : 'Required.'
        }
      ]);
      if (!answers.geminiApiKey) {
        console.log(picocolors.red('Aborted.')); process.exit(1);
      }
      config.global.geminiApiKey = answers.geminiApiKey;
      saveConfig(config);
      console.log(picocolors.green('✔ Global Gemini API Key saved!'));
    });

  // ── Create account ─────────────────────────────────────────────────────────
  account
    .command('setup')
    .description('Create a new social account (Twitter or Bluesky)')
    .action(async () => {
      console.log(picocolors.cyan('--- Create Account ---'));
      let config = loadConfig();
      config = await ensureGlobalTwitter(config);

      const hasGlobalGemini = !!config.global?.geminiApiKey;

      const answers = await prompts([
        {
          type: 'text',
          name: 'accountName',
          message: 'Account name (identifier, e.g. "shwetank"):',
          validate: v => v.trim() ? true : 'Required.'
        },
        {
          type: 'select',
          name: 'platform',
          message: 'Platform to publish to:',
          choices: [
            { title: '𝕏  Twitter (X)', value: 'twitter' },
            { title: '🦋 Bluesky', value: 'bluesky' }
          ],
          initial: 0
        },
        {
          type: 'select',
          name: 'geminiModel',
          message: 'Gemini Model:',
          choices: [
            { title: 'gemini-2.5-flash (Recommended)', value: 'gemini-2.5-flash' },
            { title: 'gemini-2.5-pro', value: 'gemini-2.5-pro' },
            { title: 'gemini-1.5-flash', value: 'gemini-1.5-flash' },
            { title: 'gemini-1.5-pro', value: 'gemini-1.5-pro' },
            { title: 'Other / Custom', value: 'custom' }
          ],
          initial: 0
        },
        {
          type: prev => prev === 'custom' ? 'text' : null,
          name: 'customGeminiModel',
          message: 'Custom Gemini Model name:',
          validate: v => v ? true : 'Required.'
        },
        {
          type: () => hasGlobalGemini ? 'select' : null,
          name: 'geminiApiKeySource',
          message: 'Gemini API Key:',
          choices: [
            { title: 'Use global Gemini API Key', value: 'global' },
            { title: 'Set account-specific Gemini API Key', value: 'profile' }
          ],
          initial: 0
        },
        {
          type: (_, values) => (!hasGlobalGemini || values.geminiApiKeySource === 'profile') ? 'password' : null,
          name: 'profileGeminiApiKey',
          message: 'Gemini API Key:',
          validate: v => v ? true : 'Required.'
        },
        {
          type: (_, values) => (!hasGlobalGemini && values.profileGeminiApiKey) ? 'confirm' : null,
          name: 'saveGeminiAsGlobal',
          message: 'Save this API key globally for all accounts?',
          initial: true
        },
        // ── Twitter auth ──
        {
          type: (_, values) => values.platform === 'twitter' ? 'select' : null,
          name: 'authMethod',
          message: 'Twitter authentication method:',
          choices: [
            { title: 'OAuth (login via global Developer App)', value: 'oauth' },
            { title: 'Manual Access Token (paste from Developer Portal)', value: 'manual' }
          ],
          initial: 0
        },
        {
          type: (_, values) => values.platform === 'twitter' && values.authMethod === 'manual' ? 'password' : null,
          name: 'accessToken',
          message: 'Twitter Access Token:'
        },
        // ── Bluesky auth ──
        {
          type: (_, values) => values.platform === 'bluesky' ? 'text' : null,
          name: 'bskyHandle',
          message: 'Bluesky handle (e.g. yourname.bsky.social):',
          validate: v => v ? true : 'Required.'
        },
        {
          type: (_, values) => values.platform === 'bluesky' ? 'password' : null,
          name: 'bskyAppPassword',
          message: 'Bluesky App Password (Settings → Privacy & Security → App Passwords):',
          validate: v => v ? true : 'Required.'
        }
      ]);

      if (!answers.accountName) {
        console.log(picocolors.red('Aborted.')); process.exit(1);
      }

      const geminiModel = answers.geminiModel === 'custom' ? answers.customGeminiModel : answers.geminiModel;
      let geminiApiKey = '';
      if (hasGlobalGemini && answers.geminiApiKeySource !== 'profile') {
        geminiApiKey = '';
      } else {
        geminiApiKey = answers.profileGeminiApiKey || '';
        if (answers.saveGeminiAsGlobal) config.global.geminiApiKey = geminiApiKey;
      }

      let twitterData = { accessToken: '', userId: '', username: '' };
      let bskyData = { identifier: '', accessJwt: '', refreshJwt: '', did: '', handle: '' };

      if (answers.platform === 'twitter') {
        if (answers.authMethod === 'manual' && answers.accessToken) {
          const spinner = ora('Verifying Twitter token...').start();
          try {
            const userId = await getTwitterUserId(answers.accessToken);
            twitterData = { accessToken: answers.accessToken, userId, username: '' };
            spinner.succeed(`Token verified! User ID: ${userId}`);
          } catch (err) {
            spinner.fail(`Token verification failed: ${err.message}`);
            console.log(picocolors.yellow('Token saved — verify it before tweeting.'));
            twitterData.accessToken = answers.accessToken;
          }
        }
      } else if (answers.platform === 'bluesky' && answers.bskyHandle && answers.bskyAppPassword) {
        const spinner = ora('Authenticating with Bluesky...').start();
        try {
          const session = await loginBluesky(answers.bskyHandle, answers.bskyAppPassword);
          bskyData = {
            identifier: answers.bskyHandle,
            accessJwt: session.accessJwt,
            refreshJwt: session.refreshJwt,
            did: session.did,
            handle: session.handle
          };
          spinner.succeed(`Authenticated as @${session.handle}`);
        } catch (err) {
          spinner.fail(`Bluesky authentication failed: ${err.message}`);
          console.log(picocolors.yellow('Credentials saved — run "login" to retry.'));
          bskyData.identifier = answers.bskyHandle;
        }
      }

      const newAccount = {
        name: answers.accountName,
        platform: answers.platform || 'twitter',
        twitter: twitterData,
        bluesky: bskyData,
        geminiApiKey,
        geminiModel,
        repositories: {}
      };

      saveConfig(saveAccount(config, newAccount));
      console.log(picocolors.green(`\n✔ Account "${answers.accountName}" created on ${answers.platform === 'bluesky' ? '🦋 Bluesky' : '𝕏 Twitter'}!`));
      if (answers.platform === 'twitter' && answers.authMethod === 'oauth') {
        console.log(picocolors.yellow(`Run "node src/index.js login ${answers.accountName}" to link Twitter.`));
      }
      console.log(picocolors.yellow(`Run "node src/index.js account repo add" to add a repository.`));
    });

  // ── List accounts ──────────────────────────────────────────────────────────
  account
    .command('list')
    .description('List all accounts')
    .action(() => {
      const config = loadConfig();
      const names = listAccounts(config);
      if (names.length === 0) {
        console.log(picocolors.yellow('No accounts found. Run "account setup" first.'));
        return;
      }
      const lastUsed = getLastUsed(config);
      console.log(picocolors.cyan(`\n── Accounts (${names.length}) ──`));
      names.forEach(name => {
        const acc = getAccount(config, name);
        const platform = acc.platform || 'twitter';
        const repos = listRepositories(config, name);
        const isLinked = platform === 'bluesky' ? !!(acc.bluesky?.accessJwt) : !!(acc.twitter?.accessToken);
        const linked = isLinked ? picocolors.green('✔ linked') : picocolors.red('✗ not linked');
        const icon = platform === 'bluesky' ? '🦋' : '𝕏';
        const isLast = name === lastUsed.account ? picocolors.gray(' [last used]') : '';
        console.log(`  ${icon} ${picocolors.bold(name)}  ${linked}  ${picocolors.gray(`${repos.length} repo(s)`)}${isLast}`);
      });
      console.log('');
    });

  // ── Show account (tree view) ───────────────────────────────────────────────
  account
    .command('show [name]')
    .description('Show account details and its repositories in a tree view')
    .action((name) => {
      const config = loadConfig();
      const lastUsed = getLastUsed(config);
      const accountName = name || lastUsed.account || listAccounts(config)[0];

      if (!accountName) {
        console.log(picocolors.yellow('No accounts found. Run "account setup" first.'));
        return;
      }

      const acc = getAccount(config, accountName);
      if (!acc) {
        console.error(picocolors.red(`✗ Account "${accountName}" not found.`)); process.exit(1);
      }

      const repos = listRepositories(config, accountName);
      const platform = acc.platform || 'twitter';
      const repoLines = repos.length === 0
        ? picocolors.gray('    (no repositories — run "account repo add")')
        : repos.map((r, i) => {
            const repo = getRepository(config, accountName, r);
            const src = repo.github.type === 'local'
              ? picocolors.gray(`local › ${repo.github.repoPath || process.cwd()}`)
              : picocolors.gray(`github › ${repo.github.owner}/${repo.github.repo}`);
            const isLast = (lastUsed.account === accountName && lastUsed.repository === r)
              ? picocolors.gray(' [last used]') : '';
            const connector = i === repos.length - 1 ? '└──' : '├──';
            return `    ${connector} ${picocolors.bold(r)}  ${src}${isLast}`;
          }).join('\n');

      const linkedLine = platform === 'bluesky'
        ? `${picocolors.cyan(picocolors.bold('Bluesky:'))} ${acc.bluesky?.accessJwt
            ? picocolors.green(`✔ linked (@${acc.bluesky.handle || acc.bluesky.identifier})`)
            : picocolors.red('✗ not linked')}`
        : `${picocolors.cyan(picocolors.bold('Twitter:'))} ${acc.twitter?.accessToken
            ? picocolors.green(`✔ linked${acc.twitter.username ? ` (@${acc.twitter.username})` : ''}`)
            : picocolors.red('✗ not linked')}`;

      console.log(boxen(
        `${picocolors.cyan(picocolors.bold('Account:'))} ${acc.name}\n` +
        `${picocolors.cyan(picocolors.bold('Platform:'))} ${platform === 'bluesky' ? '🦋 Bluesky' : '𝕏 Twitter (X)'}\n` +
        `${linkedLine}\n` +
        `${picocolors.cyan(picocolors.bold('Gemini Model:'))} ${acc.geminiModel || 'gemini-2.5-flash'}\n` +
        `${picocolors.cyan(picocolors.bold('Gemini Key:'))} ${acc.geminiApiKey
          ? '••••••••'
          : (config.global?.geminiApiKey ? picocolors.green('Global') : picocolors.red('Missing'))}\n` +
        `${picocolors.cyan(picocolors.bold('Repositories:'))}\n${repoLines}`,
        { title: `Account: ${acc.name}`, titleAlignment: 'left', padding: 1, borderColor: 'cyan' }
      ));
    });

  // ── Delete account ─────────────────────────────────────────────────────────
  account
    .command('delete <name>')
    .description('Delete an account and all its repositories')
    .action(async (name) => {
      const config = loadConfig();
      if (!getAccount(config, name)) {
        console.error(picocolors.red(`✗ Account "${name}" not found.`)); process.exit(1);
      }
      const repos = listRepositories(config, name);
      const res = await prompts({
        type: 'confirm',
        name: 'value',
        message: `Delete account "${name}" and its ${repos.length} repository(s)?`,
        initial: false
      });
      if (!res.value) { console.log('Cancelled.'); return; }
      saveConfig(deleteAccount(config, name));
      console.log(picocolors.green(`✔ Account "${name}" deleted.`));
    });

  // ── account repo sub-group ─────────────────────────────────────────────────
  const repo = account.command('repo').description('Manage repositories under an account');

  repo
    .command('add [accountName]')
    .description('Add a repository to an account')
    .action(async (accountNameArg) => {
      let config = loadConfig();
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
            message: 'Add repository to which account?',
            choices: names.map(n => ({ title: n, value: n }))
          });
          if (!res.account) process.exit(0);
          accountName = res.account;
        }
      }

      if (!getAccount(config, accountName)) {
        console.error(picocolors.red(`✗ Account "${accountName}" not found.`)); process.exit(1);
      }

      const localGitDetected = await isGitRepository(process.cwd());

      const answers = await prompts([
        {
          type: 'text',
          name: 'repoName',
          message: 'Repository name (identifier):',
          validate: v => v.trim() ? true : 'Required.'
        },
        {
          type: 'select',
          name: 'githubType',
          message: 'Git source type:',
          choices: [
            { title: `Local Repository${localGitDetected ? ' (detected in current dir)' : ''}`, value: 'local' },
            { title: 'GitHub API (remote)', value: 'github' }
          ],
          initial: 0
        },
        {
          type: prev => prev === 'local' ? 'text' : null,
          name: 'repoPath',
          message: 'Local repository path:',
          initial: process.cwd()
        },
        {
          type: (_, values) => values.githubType === 'github' ? 'text' : null,
          name: 'owner',
          message: 'GitHub Owner/Username:'
        },
        {
          type: (_, values) => values.githubType === 'github' ? 'text' : null,
          name: 'repo',
          message: 'GitHub Repository Name:'
        },
        {
          type: (_, values) => values.githubType === 'github' ? 'password' : null,
          name: 'githubToken',
          message: 'GitHub Token (optional, for private repos):'
        }
      ]);

      if (!answers.repoName) { console.log(picocolors.red('Aborted.')); process.exit(1); }

      const repoData = {
        name: answers.repoName,
        github: {
          type: answers.githubType,
          repoPath: answers.repoPath || '',
          owner: answers.owner || '',
          repo: answers.repo || '',
          token: answers.githubToken || ''
        }
      };

      config = loadConfig();
      saveConfig(saveRepository(config, accountName, repoData));
      console.log(picocolors.green(`✔ Repository "${answers.repoName}" added to account "${accountName}"!`));
    });

  repo
    .command('list [accountName]')
    .description('List repositories under an account')
    .action(async (accountNameArg) => {
      const config = loadConfig();
      const names = listAccounts(config);
      if (names.length === 0) {
        console.log(picocolors.yellow('No accounts. Run "account setup" first.')); return;
      }

      let accountName = accountNameArg;
      if (!accountName) {
        if (names.length === 1) {
          accountName = names[0];
        } else {
          const res = await prompts({
            type: 'select',
            name: 'account',
            message: 'List repos for which account?',
            choices: names.map(n => ({ title: n, value: n }))
          });
          if (!res.account) process.exit(0);
          accountName = res.account;
        }
      }

      const repos = listRepositories(config, accountName);
      const lastUsed = getLastUsed(config);
      console.log(picocolors.cyan(`\n── Repositories under "${accountName}" (${repos.length}) ──`));
      if (repos.length === 0) {
        console.log(picocolors.gray('  (none — run "account repo add")'));
      } else {
        repos.forEach((r, i) => {
          const repoData = getRepository(config, accountName, r);
          const src = repoData.github.type === 'local'
            ? picocolors.gray(`local › ${repoData.github.repoPath || process.cwd()}`)
            : picocolors.gray(`github › ${repoData.github.owner}/${repoData.github.repo}`);
          const isLast = (lastUsed.account === accountName && lastUsed.repository === r)
            ? picocolors.gray(' [last used]') : '';
          console.log(`  ${i + 1}. ${picocolors.bold(r)}  ${src}${isLast}`);
        });
      }
      console.log('');
    });

  repo
    .command('remove <repoName> [accountName]')
    .description('Remove a repository from an account')
    .action(async (repoName, accountNameArg) => {
      let config = loadConfig();
      const names = listAccounts(config);

      let accountName = accountNameArg;
      if (!accountName) {
        if (names.length === 1) {
          accountName = names[0];
        } else {
          const res = await prompts({
            type: 'select',
            name: 'account',
            message: 'Remove repo from which account?',
            choices: names.map(n => ({ title: n, value: n }))
          });
          if (!res.account) process.exit(0);
          accountName = res.account;
        }
      }

      if (!getRepository(config, accountName, repoName)) {
        console.error(picocolors.red(`✗ Repository "${repoName}" not found under "${accountName}".`)); process.exit(1);
      }

      const res = await prompts({
        type: 'confirm',
        name: 'value',
        message: `Remove repository "${repoName}" from account "${accountName}"?`,
        initial: false
      });
      if (!res.value) { console.log('Cancelled.'); return; }

      saveConfig(deleteRepository(config, accountName, repoName));
      console.log(picocolors.green(`✔ Repository "${repoName}" removed.`));
    });
}
