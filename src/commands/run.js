import prompts from 'prompts';
import picocolors from 'picocolors';
import boxen from 'boxen';
import ora from 'ora';

import {
  loadConfig,
  saveConfig,
  getAccount,
  saveAccount,
  getRepository,
  getLastUsed,
  setLastUsed,
  addHistoryEntry
} from '../storage.js';

import { getLocalCommits, getRemoteCommits } from '../github.js';
import { analyzeCommitsAndGeneratePost } from '../gemini.js';
import { publishToTwitter } from '../twitter.js';
import { publishToBluesky, refreshBlueskySession } from '../bluesky.js';
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
    .option('--instruction <text>', 'Additional instruction to pass to Gemini AI', '')
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

      // ── Gemini analysis loop ──────────────────────────────────────────────
      let additionalInstruction = options.instruction || '';
      let analysis;
      let postContent = '';

      while (true) {
        spinner.start(`Running Gemini AI (${geminiModel})...`);
        try {
          analysis = await analyzeCommitsAndGeneratePost(commits, geminiKey, geminiModel, additionalInstruction);
          postContent = analysis.linkedinPost;
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
          console.log(picocolors.yellow(`⚠ Post quality score is low (${analysis.score}/5).`));
        }

        console.log(boxen(
          postContent,
          { title: 'Post Preview', titleAlignment: 'left', padding: 1, borderColor: 'green', margin: 1 }
        ));

        if (options.yes) {
          break; // Publish immediately in non-interactive / CI modes
        }

        const actionRes = await prompts({
          type: 'select',
          name: 'value',
          message: 'What would you like to do with this post?',
          choices: [
            { title: '🚀 Publish now', value: 'publish' },
            { title: '✍  Edit post manually', value: 'edit' },
            { title: '🔄 Regenerate with additional instructions', value: 'regenerate' },
            { title: '❌ Cancel and exit', value: 'cancel' }
          ],
          initial: 0
        });

        if (!actionRes.value || actionRes.value === 'cancel') {
          console.log(picocolors.yellow('Post cancelled.'));
          process.exit(0);
        }

        if (actionRes.value === 'publish') {
          break;
        }

        if (actionRes.value === 'edit') {
          const editRes = await prompts({
            type: 'text',
            name: 'content',
            message: 'Edit the post content:',
            initial: postContent
          });
          if (editRes.content) {
            postContent = editRes.content;
            console.log(picocolors.green('✔ Post updated!'));
            const reconfirm = await prompts({
              type: 'confirm',
              name: 'value',
              message: 'Publish this edited version?',
              initial: true
            });
            if (reconfirm.value) {
              break;
            }
          }
        }

        if (actionRes.value === 'regenerate') {
          const instructionRes = await prompts({
            type: 'text',
            name: 'prompt',
            message: 'Provide additional instructions for Gemini (e.g. "make it punchier", "focus on feature X"):',
            validate: v => v ? true : 'Required.'
          });
          if (instructionRes.prompt) {
            additionalInstruction = (additionalInstruction ? additionalInstruction + '\n' : '') + instructionRes.prompt;
          }
        }
      }

      // ── Publish ───────────────────────────────────────────────────────────
      const platform = account.platform || 'twitter';

      if (platform === 'bluesky') {
        const { accessJwt, refreshJwt, did } = account.bluesky || {};
        if (!accessJwt || !did) {
          console.error(picocolors.red(`✗ Account "${account.name}" is not linked to Bluesky. Run "login ${account.name}" first.`));
          process.exit(1);
        }
        spinner.start('Publishing to Bluesky...');
        let finalAccessJwt = accessJwt;
        try {
          let postUri;
          try {
            postUri = await publishToBluesky(finalAccessJwt, did, postContent);
          } catch (firstErr) {
            // Check if error is token expiration
            if (firstErr.message.includes('ExpiredToken') && refreshJwt) {
              spinner.text = 'Token expired. Refreshing Bluesky session...';
              const session = await refreshBlueskySession(refreshJwt);
              finalAccessJwt = session.accessJwt;

              // Save the refreshed tokens back to configuration
              config = loadConfig();
              const updatedAccount = {
                ...account,
                bluesky: {
                  ...account.bluesky,
                  accessJwt: session.accessJwt,
                  refreshJwt: session.refreshJwt
                }
              };
              saveConfig(saveAccount(config, updatedAccount));

              spinner.text = 'Retrying publishing to Bluesky...';
              postUri = await publishToBluesky(finalAccessJwt, did, postContent);
            } else {
              throw firstErr;
            }
          }

          spinner.succeed(picocolors.green(`✔ Posted to Bluesky! URI: ${postUri}`));
          addHistoryEntry({
            account: account.name,
            platform: 'bluesky',
            repository: repo.name,
            postUri,
            category: analysis.category,
            score: analysis.score,
            content: postContent
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
          const tweetId = await publishToTwitter(accessToken, postContent);
          spinner.succeed(picocolors.green(`✔ Tweeted! Tweet ID: ${tweetId}`));
          addHistoryEntry({
            account: account.name,
            platform: 'twitter',
            repository: repo.name,
            tweetId,
            category: analysis.category,
            score: analysis.score,
            content: postContent
          });
        } catch (err) {
          spinner.fail(`Publication failed: ${err.message}`);
          process.exit(1);
        }
      }
    });
}
