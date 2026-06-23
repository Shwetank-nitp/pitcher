import fs from 'fs';
import path from 'path';
import os from 'os';
import picocolors from 'picocolors';

const BASE_DIR = path.join(os.homedir(), '.github-twitter-bot');
const CONFIG_PATH = path.join(BASE_DIR, 'config.json');
const HISTORY_PATH = path.join(BASE_DIR, 'history.json');

function ensureDir() {
  if (!fs.existsSync(BASE_DIR)) {
    fs.mkdirSync(BASE_DIR, { recursive: true });
  }
}

const DEFAULT_CONFIG = () => ({
  global: {
    twitter: { clientId: '', clientSecret: '' },
    geminiApiKey: ''
  },
  accounts: {},
  lastUsed: { account: '', repository: '' }
});

// Auto-migrate the old flat-profiles format to the new accounts→repositories tree
function migrateOldFormat(old) {
  console.log(picocolors.yellow('⚠ Migrating old config format to new account/repository tree structure...'));
  const config = DEFAULT_CONFIG();
  config.global = old.global || config.global;
  if (!config.global.twitter) config.global.twitter = { clientId: '', clientSecret: '' };

  for (const [name, profile] of Object.entries(old.profiles || {})) {
    config.accounts[name] = {
      name,
      twitter: {
        accessToken: profile.twitter?.accessToken || '',
        userId: profile.twitter?.userId || ''
      },
      geminiApiKey: profile.geminiApiKey || '',
      geminiModel: profile.geminiModel || 'gemini-2.5-flash',
      repositories: {
        default: {
          name: 'default',
          github: profile.github || { type: 'local', repoPath: '', owner: '', repo: '', token: '' }
        }
      }
    };
  }

  config.lastUsed = {
    account: old.activeProfile || '',
    repository: 'default'
  };

  console.log(picocolors.green('✔ Migration complete. Old profiles converted to accounts with a "default" repository.'));
  return config;
}

// ─── Core Config ────────────────────────────────────────────────────────────

export function loadConfig() {
  ensureDir();
  if (!fs.existsSync(CONFIG_PATH)) {
    return DEFAULT_CONFIG();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

    // Auto-migrate old format
    if (raw.profiles && !raw.accounts) {
      const migrated = migrateOldFormat(raw);
      saveConfig(migrated);
      return migrated;
    }

    // Ensure required keys exist
    if (!raw.global) raw.global = { twitter: { clientId: '', clientSecret: '' }, geminiApiKey: '' };
    if (!raw.global.twitter) raw.global.twitter = { clientId: '', clientSecret: '' };
    if (!raw.accounts) raw.accounts = {};
    if (!raw.lastUsed) raw.lastUsed = { account: '', repository: '' };

    return raw;
  } catch (err) {
    return DEFAULT_CONFIG();
  }
}

export function saveConfig(config) {
  ensureDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
}

// ─── Account CRUD ────────────────────────────────────────────────────────────

export function listAccounts(config) {
  return Object.keys(config.accounts || {});
}

export function getAccount(config, name) {
  return config.accounts?.[name] || null;
}

/**
 * Save/update an account. Merges with existing data so repositories are preserved.
 * accountData must have at least { name: string }.
 */
export function saveAccount(config, accountData) {
  if (!config.accounts) config.accounts = {};
  const existing = config.accounts[accountData.name] || { repositories: {} };
  config.accounts[accountData.name] = {
    ...existing,
    ...accountData,
    // Never overwrite repositories from a bare account update
    repositories: accountData.repositories || existing.repositories || {}
  };
  return config;
}

export function deleteAccount(config, name) {
  if (!config.accounts[name]) {
    throw new Error(`Account "${name}" not found.`);
  }
  delete config.accounts[name];
  // Clear lastUsed if it pointed to this account
  if (config.lastUsed?.account === name) {
    config.lastUsed = { account: '', repository: '' };
  }
  return config;
}

// ─── Repository CRUD ─────────────────────────────────────────────────────────

export function listRepositories(config, accountName) {
  return Object.keys(config.accounts?.[accountName]?.repositories || {});
}

export function getRepository(config, accountName, repoName) {
  return config.accounts?.[accountName]?.repositories?.[repoName] || null;
}

/**
 * Save/update a repository under an account.
 * repoData must have at least { name: string }.
 */
export function saveRepository(config, accountName, repoData) {
  if (!config.accounts[accountName]) {
    throw new Error(`Account "${accountName}" not found.`);
  }
  if (!config.accounts[accountName].repositories) {
    config.accounts[accountName].repositories = {};
  }
  config.accounts[accountName].repositories[repoData.name] = repoData;
  return config;
}

export function deleteRepository(config, accountName, repoName) {
  if (!config.accounts?.[accountName]?.repositories?.[repoName]) {
    throw new Error(`Repository "${repoName}" not found under account "${accountName}".`);
  }
  delete config.accounts[accountName].repositories[repoName];
  // Clear lastUsed if it pointed to this repo
  if (config.lastUsed?.account === accountName && config.lastUsed?.repository === repoName) {
    config.lastUsed.repository = '';
  }
  return config;
}

// ─── Last Used ───────────────────────────────────────────────────────────────

export function getLastUsed(config) {
  return config.lastUsed || { account: '', repository: '' };
}

export function setLastUsed(config, account, repository) {
  config.lastUsed = { account, repository };
  return config;
}

// ─── History ─────────────────────────────────────────────────────────────────

export function loadHistory() {
  ensureDir();
  if (!fs.existsSync(HISTORY_PATH)) return [];
  try {
    return JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf8'));
  } catch {
    return [];
  }
}

export function saveHistory(history) {
  ensureDir();
  fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), 'utf8');
}

export function addHistoryEntry(entry) {
  const history = loadHistory();
  history.push({ timestamp: new Date().toISOString(), ...entry });
  saveHistory(history);
}

// ─── Wipe ────────────────────────────────────────────────────────────────────

export function clearAllData() {
  if (fs.existsSync(BASE_DIR)) {
    fs.rmSync(BASE_DIR, { recursive: true, force: true });
  }
}
