import picocolors from 'picocolors';
import { loadHistory } from '../storage.js';

/**
 * Registers the `history` and `logs` commands on the program.
 */
export function registerHistory(program) {

  // ── history ────────────────────────────────────────────────────────────────
  program
    .command('history')
    .description('Show published post history')
    .action(() => {
      const history = loadHistory();
      if (history.length === 0) {
        console.log(picocolors.yellow('No history found.')); return;
      }
      console.log(picocolors.cyan(`\n── Post History (${history.length}) ──`));
      history.forEach((h, idx) => {
        const platform = h.platform || 'twitter';
        const platformLabel = platform === 'bluesky' ? '🦋 Bluesky' : '𝕏 Twitter';
        const postId = h.postUri || h.tweetId || 'unknown';
        const postIdLabel = platform === 'bluesky' ? 'Post URI' : 'Tweet ID';
        console.log(picocolors.green(`\n[${idx + 1}] ${h.timestamp}  account: ${h.account}  repo: ${h.repository}  platform: ${platformLabel}`));
        console.log(`${picocolors.cyan(`${postIdLabel}:`)} ${postId}`);
        console.log(`${picocolors.cyan('Category:')} ${h.category}  |  ${picocolors.cyan('Score:')} ${h.score}/5`);
        console.log(picocolors.gray('─'.repeat(60)));
        console.log(h.content);
        console.log(picocolors.gray('─'.repeat(60)));
      });
    });

  // ── logs ───────────────────────────────────────────────────────────────────
  program
    .command('logs')
    .description('Show recent operation logs (compact view)')
    .action(() => {
      const history = loadHistory();
      if (history.length === 0) {
        console.log(picocolors.yellow('No logs found.')); return;
      }
      console.log(picocolors.cyan('── Operations Log ──'));
      history.forEach(h => {
        const platform = h.platform || 'twitter';
        const postId = h.postUri || h.tweetId || 'unknown';
        const icon = platform === 'bluesky' ? '🦋' : '𝕏';
        console.log(
          `${picocolors.gray(`[${h.timestamp}]`)} ` +
          `${picocolors.green('POST_SUCCESS')} ${icon} ` +
          `account=${h.account}  repo=${h.repository}  ` +
          `postId=${postId}  score=${h.score}/5  category=${h.category}`
        );
      });
    });
}
