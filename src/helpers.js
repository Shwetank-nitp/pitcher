import prompts from 'prompts';
import picocolors from 'picocolors';

import {
  loadConfig,
  saveConfig,
  listAccounts,
  getAccount,
  listRepositories,
  getRepository
} from './storage.js';

// ─── Account picker ──────────────────────────────────────────────────────────

/**
 * Interactive prompt to select an account. Returns the account object.
 * If defaultName is given and valid, it is pre-selected.
 */
export async function pickAccount(config, defaultName) {
  const names = listAccounts(config);
  if (names.length === 0) {
    console.error(picocolors.red('✗ No accounts found. Run "account setup" first.'));
    process.exit(1);
  }
  if (names.length === 1) return getAccount(config, names[0]);

  const defaultIdx = defaultName ? Math.max(0, names.indexOf(defaultName)) : 0;
  const res = await prompts({
    type: 'select',
    name: 'account',
    message: 'Select account:',
    choices: names.map(n => {
      const acc = getAccount(config, n);
      const platform = acc.platform || 'twitter';
      const isLinked = platform === 'bluesky'
        ? !!(acc.bluesky?.accessJwt)
        : !!(acc.twitter?.accessToken);
      const linked = isLinked ? picocolors.green('linked') : picocolors.red('not linked');
      const icon = platform === 'bluesky' ? '🦋' : '𝕏';
      return { title: `${icon} ${n}  [${linked}]`, value: n };
    }),
    initial: defaultIdx
  });
  if (!res.account) process.exit(0);
  return getAccount(config, res.account);
}

// ─── Repository picker ────────────────────────────────────────────────────────

/**
 * Interactive prompt to select a repository under an account. Returns the repo object.
 */
export async function pickRepository(config, accountName, defaultName) {
  const names = listRepositories(config, accountName);
  if (names.length === 0) {
    console.error(picocolors.red(`✗ No repositories found under "${accountName}". Run "account repo add" first.`));
    process.exit(1);
  }
  if (names.length === 1) return getRepository(config, accountName, names[0]);

  const defaultIdx = defaultName ? Math.max(0, names.indexOf(defaultName)) : 0;
  const res = await prompts({
    type: 'select',
    name: 'repo',
    message: `Select repository under "${accountName}":`,
    choices: names.map(n => {
      const r = getRepository(config, accountName, n);
      const src = r.github.type === 'local'
        ? picocolors.gray(`local: ${r.github.repoPath || process.cwd()}`)
        : picocolors.gray(`github: ${r.github.owner}/${r.github.repo}`);
      return { title: `${n}  [${src}]`, value: n };
    }),
    initial: defaultIdx
  });
  if (!res.repo) process.exit(0);
  return getRepository(config, accountName, res.repo);
}

// ─── Global Twitter credentials guard ────────────────────────────────────────

/**
 * Ensures global Twitter Developer App credentials are set.
 * If not, prompts the user to enter them inline.
 * Returns the (possibly updated) config.
 */
export async function ensureGlobalTwitter(config) {
  const hasGlobal = !!(config.global?.twitter?.clientId && config.global?.twitter?.clientSecret);
  if (hasGlobal) return config;

  console.log(picocolors.yellow('\n✗ Global Twitter Developer App credentials are not set.'));
  console.log(picocolors.cyan("Let's configure them now.\n"));
  const answers = await prompts([
    {
      type: 'text',
      name: 'clientId',
      message: 'Twitter Client ID:',
      validate: v => v ? true : 'Required.'
    },
    {
      type: 'password',
      name: 'clientSecret',
      message: 'Twitter Client Secret:',
      validate: v => v ? true : 'Required.'
    }
  ]);
  if (!answers.clientId || !answers.clientSecret) {
    console.log(picocolors.red('Aborted.'));
    process.exit(1);
  }
  config.global.twitter = { clientId: answers.clientId, clientSecret: answers.clientSecret };
  saveConfig(config);
  console.log(picocolors.green('✔ Global Twitter credentials saved!\n'));
  return config;
}
