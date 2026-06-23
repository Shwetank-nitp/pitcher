import express from 'express';
import axios from 'axios';
import { loadConfig, saveConfig, getAccount, saveAccount } from './storage.js';
import picocolors from 'picocolors';

/**
 * Run the Twitter OAuth 2.0 PKCE flow for a specific account.
 * @param {string} accountName - The account name to link the token to.
 */
export async function startOAuthFlow(accountName) {
  const config = loadConfig();
  const { clientId, clientSecret } = config.global?.twitter || {};

  if (!clientId || !clientSecret) {
    throw new Error('Global Twitter Client ID and Client Secret are required. Run "account setup-global" first.');
  }

  const account = getAccount(config, accountName);
  if (!account) {
    throw new Error(`Account "${accountName}" not found. Run "account setup" first.`);
  }

  const PORT = 3000;
  const redirectUri = `http://localhost:${PORT}/callback`;
  const state = Math.random().toString(36).substring(7);
  const codeVerifier = state;
  const codeChallenge = state;

  const scopes = 'tweet.read tweet.write users.read offline.access';
  const authUrl =
    `https://twitter.com/i/oauth2/authorize?response_type=code` +
    `&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scopes)}` +
    `&state=${state}` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=plain`;

  const app = express();
  let server;

  const serverPromise = new Promise((resolve, reject) => {
    app.get('/callback', async (req, res) => {
      const { code, state: returnedState, error, error_description } = req.query;

      if (error) {
        res.send(`<h1>Authentication Failed</h1><p>${error_description || error}</p>`);
        reject(new Error(`Twitter OAuth Error: ${error_description || error}`));
        return;
      }

      if (returnedState !== state) {
        res.send('<h1>Authentication Failed</h1><p>State mismatch error.</p>');
        reject(new Error('State mismatch. Possible CSRF attack.'));
        return;
      }

      try {
        const credentials = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');

        const tokenResponse = await axios.post(
          'https://api.twitter.com/2/oauth2/token',
          new URLSearchParams({
            code,
            grant_type: 'authorization_code',
            redirect_uri: redirectUri,
            code_verifier: codeVerifier,
            client_id: clientId
          }).toString(),
          {
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              Authorization: `Basic ${credentials}`
            }
          }
        );

        const { access_token } = tokenResponse.data;

        const userinfoResponse = await axios.get('https://api.twitter.com/2/users/me', {
          headers: { Authorization: `Bearer ${access_token}` }
        });

        const userId = userinfoResponse.data.data.id;
        const username = userinfoResponse.data.data.username;

        // Save token back to the specific account
        const freshConfig = loadConfig();
        const acc = getAccount(freshConfig, accountName);
        acc.twitter.accessToken = access_token;
        acc.twitter.userId = userId;
        acc.twitter.username = username;
        saveConfig(saveAccount(freshConfig, acc));

        res.send(
          `<h1>Authentication Successful!</h1>` +
          `<p>Logged in as <strong>@${username}</strong>. You may close this tab and return to the CLI.</p>`
        );
        console.log(picocolors.green(`\n✔ Authenticated account "${accountName}" as @${username}`));
        resolve({ username, userId });
      } catch (err) {
        const errorMsg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
        res.send(`<h1>Token Exchange Failed</h1><p>${errorMsg}</p>`);
        reject(new Error(`Failed to exchange authorization code: ${errorMsg}`));
      } finally {
        if (server) server.close();
      }
    });

    server = app.listen(PORT, () => {
      console.log(picocolors.cyan('\nStarting Twitter OAuth helper...'));
      console.log(picocolors.yellow('Open the following URL in your browser:'));
      console.log(picocolors.blue(picocolors.underline(authUrl)));
      console.log(picocolors.gray('\nWaiting for callback on http://localhost:3000/callback...'));
    });
  });

  return serverPromise;
}
