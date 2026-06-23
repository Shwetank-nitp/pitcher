import prompts from 'prompts';
import picocolors from 'picocolors';
import boxen from 'boxen';
import ora from 'ora';

import {
  loadConfig,
  saveConfig,
  getAccount,
  getRepository,
  getLastUsed,
  setLastUsed,
  addHistoryEntry
} from '../storage.js';

import { getLocalCommits, getRemoteCommits } from '../github.js';
import { analyzeCommitsAndGeneratePost } from '../gemini.js';
import { publishToTwitter } from '../twitter.js';
import { publishToBluesky } from '../bluesky.js';
import { pickAccount, pickRepository } from '../helpers.js';

/**
 * Registers the `run` command on the given Commander program.
 */
export function registerRun(program) {
  program
    .command('run')
    .description('Select an account & repository, then generate and post to social media')
    .option('--account <name>', 'Account name to use (skips account prompt)')
    .option('--repo <name>',    'Repository name to use (skips repo prompt)')
    .option('--yes',            'Skip confirmation and post immediately')
    .option('--limit <number>', 'Number of commits to analyze', '15')
    .action(async (options) => {
      let config = loadConfig();
      const lastUsed = getLastUsed(config);
      const limit = parseInt(options.limit, 10);

      // ── Select account ────────────────────────────────────────────────────
      let account;
      if (options.account) {
        account = getAccount(config, options.account);
        if (!account) {
          console.error(picocolors.red(`✗ Account "${options.account}" not found.`));
          process.exit(1);
        }
      } else {
        account = await pickAccount(config, lastUsed.account);
      }

      // ── Select repository ─────────────────────────────────────────────────
      let repo;
      if (options.repo) {
        repo = getRepository(config, account.name, options.repo);
        if (!repo) {
          console.error(picocolors.red(`✗ Repository "${options.repo}" not found under account "${account.name}".`));
          process.exit(1);
        }
      } else {
        const defaultRepo = (lastUsed.account === account.name) ? lastUsed.repository : '';
        repo = await pickRepository(config, account.name, defaultRepo);
      }

      // Save lastUsed
      config = loadConfig();
      saveConfig(setLastUsed(config, account.name, repo.name));

      console.log(picocolors.cyan(`\n▶ Running: account="${account.name}"  repo="${repo.name}"\n`));

      // ── Gemini key resolution ─────────────────────────────────────────────
      const geminiKey = account.geminiApiKey || config.global?.geminiApiKey || process.env.GEMINI_API_KEY;
      const geminiModel = account.geminiModel || 'gemini-2.5-flash';
      if (!geminiKey) {
        console.error(picocolors.red('✗ Gemini API Key is missing. Run "account setup-global-gemini" or configure one in account setup.'));
        process.exit(1);
      }

      // ── Fetch commits ─────────────────────────────────────────────────────
      const spinner = ora('Fetching commits...').start();
      let commits = [];
      try {
        if (repo.github.type === 'local') {
          const repoPath = repo.github.repoPath || process.cwd();
          spinner.text = `Scraping local commits from: ${repoPath}`;
          commits = await getLocalCommits(repoPath, limit);
        } else {
          const { owner, repo: repoName, token } = repo.github;
          if (!owner || !repoName) {
            spinner.fail('GitHub API config incomplete. Check "account repo add".');
            process.exit(1);
          }
          spinner.text = `Fetching GitHub API commits for ${owner}/${repoName}`;
          commits = await getRemoteCommits(owner, repoName, token || process.env.GITHUB_TOKEN, limit);
        }
      } catch (err) {
        spinner.fail(`Failed to fetch commits: ${err.message}`);
        process.exit(1);
      }

      if (commits.length === 0) {
        spinner.warn('No commits found to analyze.');
        process.exit(0);
      }
      spinner.succeed(`Scraped ${commits.length} commits.`);

      // ── Gemini analysis ───────────────────────────────────────────────────
      spinner.start(`Running Gemini AI (${geminiModel})...`);
      let analysis;
      try {
        analysis = await analyzeCommitsAndGeneratePost(commits, geminiKey, geminiModel);
      } catch (err) {
        spinner.fail(`Gemini analysis failed: ${err.message}`);
        process.exit(1);
      }
      spinner.succeed('Gemini analysis complete.');

      console.log('\n' + boxen(
        `${picocolors.cyan(picocolors.bold('Category:'))} ${analysis.category}\n` +
        `${picocolors.cyan(picocolors.bold('AI Quality Score:'))} ${analysis.score}/5\n` +
        `${picocolors.cyan(picocolors.bold('Explanation:'))} ${analysis.explanation}`,
        { title: 'Gemini Analysis Summary', titleAlignment: 'left', padding: 1, borderColor: 'cyan', margin: 1 }
      ));

      if (analysis.score < 4 && !options.yes) {
        console.log(picocolors.yellow(`⚠ Post quality score is low (${analysis.score}/5). Exiting without posting.`));
        process.exit(0);
      }

      console.log(boxen(
        analysis.linkedinPost,
        { title: 'Post Preview', titleAlignment: 'left', padding: 1, borderColor: 'green', margin: 1 }
      ));

      let confirm = options.yes;
      if (!confirm) {
        const res = await prompts({
          type: 'confirm',
          name: 'value',
          message: 'Post this?',
          initial: false
        });
        confirm = res.value;
      }

      if (!confirm) {
        console.log(picocolors.yellow('Post cancelled.'));
        process.exit(0);
      }

      // ── Publish ───────────────────────────────────────────────────────────
      const platform = account.platform || 'twitter';

      if (platform === 'bluesky') {
        const { accessJwt, did } = account.bluesky || {};
        if (!accessJwt || !did) {
          console.error(picocolors.red(`✗ Account "${account.name}" is not linked to Bluesky. Run "login ${account.name}" first.`));
          process.exit(1);
        }
        spinner.start('Publishing to Bluesky...');
        try {
          const postUri = await publishToBluesky(accessJwt, did, analysis.linkedinPost);
          spinner.succeed(picocolors.green(`✔ Posted to Bluesky! URI: ${postUri}`));
          addHistoryEntry({
            account: account.name,
            platform: 'bluesky',
            repository: repo.name,
            postUri,
            category: analysis.category,
            score: analysis.score,
            content: analysis.linkedinPost
          });
        } catch (err) {
          spinner.fail(`Publication failed: ${err.message}`);
          process.exit(1);
        }
      } else {
        const accessToken = account.twitter?.accessToken;
        if (!accessToken) {
          console.error(picocolors.red(`✗ Account "${account.name}" is not linked to Twitter. Run "login ${account.name}" first.`));
          process.exit(1);
        }
        spinner.start('Publishing to Twitter (X)...');
        try {
          const tweetId = await publishToTwitter(accessToken, analysis.linkedinPost);
          spinner.succeed(picocolors.green(`✔ Tweeted! Tweet ID: ${tweetId}`));
          addHistoryEntry({
            account: account.name,
            platform: 'twitter',
            repository: repo.name,
            tweetId,
            category: analysis.category,
            score: analysis.score,
            content: analysis.linkedinPost
          });
        } catch (err) {
          spinner.fail(`Publication failed: ${err.message}`);
          process.exit(1);
        }
      }
    });
}
