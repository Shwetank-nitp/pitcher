import test from 'node:test';
import assert from 'node:assert';
import fs from 'fs';
import path from 'path';
import axios from 'axios';
import { exec } from 'child_process';

// Import the modules to test
import {
  listAccounts,
  getAccount,
  saveAccount,
  deleteAccount,
  listRepositories,
  getRepository,
  saveRepository,
  deleteRepository,
  getLastUsed,
  setLastUsed
} from '../src/storage.js';

import {
  isGitRepository,
  getLocalCommits,
  getRemoteCommits
} from '../src/github.js';

import {
  loginBluesky,
  publishToBluesky,
  deleteBlueskyPost
} from '../src/bluesky.js';

import {
  getTwitterUserId,
  publishToTwitter,
  deleteTwitterTweet
} from '../src/twitter.js';

// ─── Storage Tests ──────────────────────────────────────────────────────────

test('Storage CRUD operations on memory config object', async (t) => {
  await t.test('should list, get, save, and delete accounts', () => {
    let config = { accounts: {}, lastUsed: { account: '', repository: '' } };

    // Initial state
    assert.deepEqual(listAccounts(config), []);
    assert.equal(getAccount(config, 'alice'), null);

    // Save account
    config = saveAccount(config, {
      name: 'alice',
      platform: 'twitter',
      twitter: { accessToken: 'token123' }
    });

    assert.deepEqual(listAccounts(config), ['alice']);
    const alice = getAccount(config, 'alice');
    assert.equal(alice.name, 'alice');
    assert.equal(alice.platform, 'twitter');
    assert.equal(alice.twitter.accessToken, 'token123');

    // Delete account
    config = deleteAccount(config, 'alice');
    assert.deepEqual(listAccounts(config), []);
    assert.equal(getAccount(config, 'alice'), null);
  });

  await t.test('should handle repositories under accounts', () => {
    let config = {
      accounts: {
        bob: {
          name: 'bob',
          repositories: {}
        }
      }
    };

    assert.deepEqual(listRepositories(config, 'bob'), []);
    assert.equal(getRepository(config, 'bob', 'my-repo'), null);

    // Save repo
    config = saveRepository(config, 'bob', {
      name: 'my-repo',
      github: { type: 'local', repoPath: '/path/to/repo' }
    });

    assert.deepEqual(listRepositories(config, 'bob'), ['my-repo']);
    const repo = getRepository(config, 'bob', 'my-repo');
    assert.ok(repo);
    assert.equal(repo.github.repoPath, '/path/to/repo');

    // Delete repo
    config = deleteRepository(config, 'bob', 'my-repo');
    assert.deepEqual(listRepositories(config, 'bob'), []);
    assert.equal(getRepository(config, 'bob', 'my-repo'), null);
  });

  await t.test('should track lastUsed settings', () => {
    let config = { lastUsed: { account: '', repository: '' } };
    assert.deepEqual(getLastUsed(config), { account: '', repository: '' });

    config = setLastUsed(config, 'bob', 'my-repo');
    assert.deepEqual(getLastUsed(config), { account: 'bob', repository: 'my-repo' });
  });
});

// ─── GitHub Tests ───────────────────────────────────────────────────────────

test('GitHub Module', async (t) => {
  await t.test('isGitRepository returns false for non-existent path', async () => {
    const isGit = await isGitRepository('/non/existent/path/at/all');
    assert.equal(isGit, false);
  });

  await t.test('getRemoteCommits successfully requests and maps response', async () => {
    const originalGet = axios.get;
    
    // Mock axios.get
    axios.get = async (url, options) => {
      assert.match(url, /api\.github\.com\/repos\/owner1\/repo1\/commits/);
      assert.equal(options.headers['Authorization'], 'token ghp_123');
      return {
        data: [
          {
            sha: 'abcdef1234567890',
            commit: {
              author: { date: '2026-06-23T12:00:00Z' },
              message: 'feat: add awesome feature\nMore details here'
            }
          }
        ]
      };
    };

    try {
      const commits = await getRemoteCommits('owner1', 'repo1', 'ghp_123', 5);
      assert.equal(commits.length, 1);
      assert.equal(commits[0].hash, 'abcdef1');
      assert.equal(commits[0].date, '2026-06-23');
      assert.equal(commits[0].message, 'feat: add awesome feature');
    } finally {
      // Restore
      axios.get = originalGet;
    }
  });
});

// ─── Twitter Tests ──────────────────────────────────────────────────────────

test('Twitter Module', async (t) => {
  const originalGet = axios.get;
  const originalPost = axios.post;
  const originalDelete = axios.delete;

  t.afterEach(() => {
    axios.get = originalGet;
    axios.post = originalPost;
    axios.delete = originalDelete;
  });

  await t.test('getTwitterUserId fetches and returns ID', async () => {
    axios.get = async (url, config) => {
      assert.equal(url, 'https://api.twitter.com/2/users/me');
      assert.equal(config.headers['Authorization'], 'Bearer tw_token');
      return { data: { data: { id: '998877' } } };
    };

    const userId = await getTwitterUserId('tw_token');
    assert.equal(userId, '998877');
  });

  await t.test('publishToTwitter posts tweet and returns tweet ID', async () => {
    axios.post = async (url, data, config) => {
      assert.equal(url, 'https://api.twitter.com/2/tweets');
      assert.equal(data.text, 'Hello World!');
      assert.equal(config.headers['Authorization'], 'Bearer tw_token');
      return { data: { data: { id: 'tweet_123' } } };
    };

    const tweetId = await publishToTwitter('tw_token', 'Hello World!');
    assert.equal(tweetId, 'tweet_123');
  });

  await t.test('deleteTwitterTweet calls delete endpoint', async () => {
    let deleted = false;
    axios.delete = async (url, config) => {
      assert.equal(url, 'https://api.twitter.com/2/tweets/tweet_123');
      assert.equal(config.headers['Authorization'], 'Bearer tw_token');
      deleted = true;
      return { data: {} };
    };

    const result = await deleteTwitterTweet('tw_token', 'tweet_123');
    assert.equal(result, true);
    assert.equal(deleted, true);
  });
});

// ─── Bluesky Tests ──────────────────────────────────────────────────────────

test('Bluesky Module', async (t) => {
  const originalPost = axios.post;

  t.afterEach(() => {
    axios.post = originalPost;
  });

  await t.test('loginBluesky returns session info', async () => {
    axios.post = async (url, data) => {
      assert.match(url, /com\.atproto\.server\.createSession/);
      assert.equal(data.identifier, 'user.bsky.social');
      assert.equal(data.password, 'pass123');
      return {
        data: {
          accessJwt: 'acc_jwt',
          refreshJwt: 'ref_jwt',
          did: 'did:plc:123',
          handle: 'user.bsky.social'
        }
      };
    };

    const session = await loginBluesky('user.bsky.social', 'pass123');
    assert.deepEqual(session, {
      accessJwt: 'acc_jwt',
      refreshJwt: 'ref_jwt',
      did: 'did:plc:123',
      handle: 'user.bsky.social'
    });
  });

  await t.test('publishToBluesky posts single message if under character limit', async () => {
    let postCount = 0;
    axios.post = async (url, data, config) => {
      assert.match(url, /com\.atproto\.repo\.createRecord/);
      assert.equal(data.repo, 'did:plc:123');
      assert.equal(data.record.text, 'Short post');
      assert.equal(config.headers['Authorization'], 'Bearer bsky_jwt');
      postCount++;
      return { data: { uri: 'at://did:plc:123/app.bsky.feed.post/post1', cid: 'cid1' } };
    };

    const uri = await publishToBluesky('bsky_jwt', 'did:plc:123', 'Short post');
    assert.equal(uri, 'at://did:plc:123/app.bsky.feed.post/post1');
    assert.equal(postCount, 1);
  });

  await t.test('publishToBluesky auto-threads multiple messages if text exceeds limits', async () => {
    // Generate text longer than 295 chars
    const longText = 'This is a long sentence. '.repeat(15);
    
    const posts = [];
    axios.post = async (url, data) => {
      posts.push(data);
      const postIndex = posts.length;
      return { data: { uri: `at://did:plc:123/app.bsky.feed.post/post${postIndex}`, cid: `cid${postIndex}` } };
    };

    const uri = await publishToBluesky('bsky_jwt', 'did:plc:123', longText);
    assert.equal(uri, 'at://did:plc:123/app.bsky.feed.post/post1');
    assert.ok(posts.length > 1, `Should create multiple posts in thread. Actual post count: ${posts.length}`);

    // Verify reply structure
    for (let i = 1; i < posts.length; i++) {
      assert.ok(posts[i].record.reply, `Post at index ${i} should have a reply ref`);
      assert.equal(posts[i].record.reply.root.uri, 'at://did:plc:123/app.bsky.feed.post/post1');
      assert.equal(posts[i].record.reply.parent.uri, `at://did:plc:123/app.bsky.feed.post/post${i}`);
    }
  });

  await t.test('deleteBlueskyPost calls deleteRecord with extracted rkey', async () => {
    let deleted = false;
    axios.post = async (url, data, config) => {
      assert.match(url, /com\.atproto\.repo\.deleteRecord/);
      assert.equal(data.repo, 'did:plc:123');
      assert.equal(data.collection, 'app.bsky.feed.post');
      assert.equal(data.rkey, 'rkey123');
      assert.equal(config.headers['Authorization'], 'Bearer bsky_jwt');
      deleted = true;
      return { data: {} };
    };

    await deleteBlueskyPost('bsky_jwt', 'did:plc:123', 'at://did:plc:123/app.bsky.feed.post/rkey123');
    assert.equal(deleted, true);
  });
});
