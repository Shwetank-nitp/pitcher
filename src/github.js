import { exec } from 'child_process';
import { promisify } from 'util';
import axios from 'axios';
import path from 'path';
import fs from 'fs';

const execAsync = promisify(exec);

export async function isGitRepository(repoPath = process.cwd()) {
  try {
    const gitDir = path.join(repoPath, '.git');
    return fs.existsSync(gitDir);
  } catch (err) {
    return false;
  }
}

export async function getLocalCommits(repoPath = process.cwd(), limit = 15) {
  try {
    const isGit = await isGitRepository(repoPath);
    if (!isGit) {
      throw new Error(`Path "${repoPath}" is not a Git repository.`);
    }

    // Get commits from past 7 days or last N commits
    const cmd = `git -C "${repoPath}" log -n ${limit} --pretty=format:"%h | %ad | %s" --date=short`;
    const { stdout } = await execAsync(cmd);
    
    if (!stdout.trim()) {
      return [];
    }

    return stdout.trim().split('\n').map(line => {
      const [hash, date, message] = line.split(' | ');
      return { hash, date, message };
    });
  } catch (err) {
    throw new Error(`Failed to read local Git history: ${err.message}`);
  }
}

export async function getRemoteCommits(owner, repo, token, limit = 15) {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=${limit}`;
    const headers = {};
    if (token) {
      headers['Authorization'] = `token ${token}`;
    }
    headers['User-Agent'] = 'github-linkedin-bot';

    const response = await axios.get(url, { headers });
    return response.data.map(item => ({
      hash: item.sha.substring(0, 7),
      date: item.commit.author.date.split('T')[0],
      message: item.commit.message.split('\n')[0] // first line of message
    }));
  } catch (err) {
    throw new Error(`Failed to fetch commits from GitHub API: ${err.message}`);
  }
}
