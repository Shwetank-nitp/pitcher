# GitHub Social Bot 🤖✨

An AI-powered CLI tool that analyzes your Git commits, uses **Gemini AI** to evaluate quality and craft a polished post, then publishes it to **Twitter (X)** or **Bluesky** — all from your terminal.

Supports multiple accounts, multiple repositories per account, and a clean interactive workflow.

---

## Features

- 🦋 **Dual Platform** — Publish to **Twitter (X)** via OAuth 2.0 PKCE _or_ **Bluesky** via App Password. Mix platforms across accounts.
- 👥 **Multi-Account / Multi-Repo Tree** — Create multiple social accounts, each with multiple Git repositories attached. `run` prompts you to pick account → repository interactively.
- 🧠 **Gemini AI Analysis** — Evaluates commit quality (1–5 score), classifies category, and generates a platform-appropriate post.
- 🔵 **Bluesky Auto-Threading** — If the generated post exceeds 300 graphemes, it automatically splits into a native thread.
- 🔑 **Global Config** — Set your Twitter Developer App credentials and Gemini API key once globally; all accounts share them.
- 💎 **Premium Terminal UI** — Styled boxes, spinners, color themes, and interactive menus via `prompts`.
- 🚀 **GitHub Actions Support** — Run automatically on a cron schedule targeting Twitter or Bluesky.

---

## Prerequisites

### 1. Gemini API Key
Get one from [Google AI Studio](https://aistudio.google.com/).

### 2a. Twitter Developer App _(only for Twitter accounts)_
1. Go to [developer.twitter.com](https://developer.twitter.com) → **New Project** → **New App**.
2. Under **User Authentication Settings**:
   - App permissions: **Read and Write**
   - Type of App: **Web App, Automated App or Bot**
   - Callback URI: `http://localhost:3000/callback`
3. From **Keys and Tokens** → **OAuth 2.0** → copy **Client ID** and **Client Secret**.

### 2b. Bluesky App Password _(only for Bluesky accounts)_
1. Log in to [bsky.social](https://bsky.social).
2. Go to **Settings → Privacy & Security → App Passwords** → **Add App Password**.
3. Note your **handle** (e.g. `yourname.bsky.social`) and the generated password.

---

## Installation & Global Setup

### Local Setup
```bash
git clone <this-repo>
cd pitcher
npm install
```

### Global Installation
You can install this CLI tool globally to run it from any directory on your system:
```bash
npm run install-global
```

Once installed globally, you can invoke the CLI with:
```bash
pitcher [command]
```

To remove the global installation:
```bash
npm run uninstall-global
```

---

## Testing

Run the native test suite to verify code correctness and API mock outputs:
```bash
npm test
```


---

## Quick Start

### Step 1 — Global setup (do this once)

```bash
# Save Twitter Developer App credentials (required for any Twitter account)
node src/index.js account setup-global

# Save a global Gemini API Key (can also be set per-account)
node src/index.js account setup-global-gemini
```

### Step 2 — Create an account

```bash
node src/index.js account setup
```

You will be asked to:
- Pick a name (e.g. `myhandle`)
- Choose platform: **Twitter (X)** or **Bluesky**
- Select Gemini model and API key
- Authenticate (OAuth for Twitter / App Password for Bluesky)

### Step 3 — Add a repository

```bash
node src/index.js account repo add
```

Select the account, give the repo a name, then choose **Local path** or **GitHub API (remote)**.

### Step 4 — Run

```bash
node src/index.js run
```

Prompts you to pick an account → repository → analyzes commits → previews post → confirms → publishes.

---

## CLI Command Reference

### Global configuration
```bash
node src/index.js account setup-global          # Twitter Client ID + Secret
node src/index.js account setup-global-gemini   # Gemini API Key
```

### Account management
```bash
node src/index.js account setup           # Create a new account (Twitter or Bluesky)
node src/index.js account list            # List all accounts
node src/index.js account show [name]     # Tree view: account + all repositories
node src/index.js account delete <name>   # Delete account and all its repositories
```

### Repository management
```bash
node src/index.js account repo add [accountName]           # Add a repository to an account
node src/index.js account repo list [accountName]          # List repositories under an account
node src/index.js account repo remove <repoName> [account] # Remove a repository
```

### Authentication
```bash
node src/index.js login [accountName]    # Link Twitter (OAuth) or re-authenticate Bluesky
node src/index.js logout [accountName]   # Clear stored credentials for an account
```

### Run the pipeline
```bash
node src/index.js run                          # Interactive account + repo selection
node src/index.js run --account myhandle       # Skip account prompt
node src/index.js run --account myhandle --repo my-project  # Skip both prompts
node src/index.js run --yes                    # Skip post confirmation (good for CI)
node src/index.js run --limit 20              # Analyze 20 commits (default: 15)
```

### History & logs
```bash
node src/index.js history             # Full post history with content preview
node src/index.js logs                # Compact operations log
```

### Deleting posts
```bash
# Twitter — pass the Tweet ID
node src/index.js delete post 1234567890123456789

# Bluesky — pass the AT URI shown in `history`
node src/index.js delete post at://did:plc:xxx/app.bsky.feed.post/rkey

# Clear all local history logs (keeps accounts/repos)
node src/index.js delete logs
```

### Nuclear option
```bash
node src/index.js kill   # Wipes ~/.github-twitter-bot entirely (all accounts, repos, history)
```

---

## Data Storage

All configuration is stored locally in `~/.github-twitter-bot/config.json`.

```
~/.github-twitter-bot/
  config.json   ← accounts, repositories, global credentials
  history.json  ← published post history
```

Config structure:
```jsonc
{
  "global": {
    "twitter": { "clientId": "...", "clientSecret": "..." },
    "geminiApiKey": "..."
  },
  "accounts": {
    "myhandle": {
      "platform": "twitter",              // "twitter" | "bluesky"
      "twitter": { "accessToken": "..." },
      "bluesky": { "accessJwt": "...", "did": "...", "handle": "..." },
      "geminiModel": "gemini-2.5-flash",
      "repositories": {
        "my-project": {
          "github": { "type": "local", "repoPath": "/path/to/repo" }
        }
      }
    }
  }
}
```

---

## GitHub Actions Integration

Add a workflow file to automatically post on a schedule:

```yaml
name: Daily Social Post

on:
  schedule:
    - cron: '0 17 * * 1-5'   # Every weekday at 5 PM UTC
  workflow_dispatch:

jobs:
  post:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      # ── Twitter example ──────────────────────────────────────────────────
      - name: Post to Twitter
        uses: ./
        with:
          gemini_api_key: ${{ secrets.GEMINI_API_KEY }}
          platform: twitter
          twitter_access_token: ${{ secrets.TWITTER_ACCESS_TOKEN }}
          twitter_user_id: ${{ secrets.TWITTER_USER_ID }}
          limit: '15'

      # ── Bluesky example ──────────────────────────────────────────────────
      # - name: Post to Bluesky
      #   uses: ./
      #   with:
      #     gemini_api_key: ${{ secrets.GEMINI_API_KEY }}
      #     platform: bluesky
      #     bluesky_identifier: ${{ secrets.BLUESKY_IDENTIFIER }}
      #     bluesky_app_password: ${{ secrets.BLUESKY_APP_PASSWORD }}
      #     limit: '15'
```

### Required Secrets

| Secret | When needed |
|---|---|
| `GEMINI_API_KEY` | Always |
| `TWITTER_ACCESS_TOKEN` | `platform: twitter` |
| `TWITTER_USER_ID` | `platform: twitter` |
| `BLUESKY_IDENTIFIER` | `platform: bluesky` |
| `BLUESKY_APP_PASSWORD` | `platform: bluesky` |

---

## Supported Gemini Models

| Model | Speed | Quality |
|---|---|---|
| `gemini-2.5-flash` _(default)_ | Fast | Good |
| `gemini-2.5-pro` | Slower | Best |
| `gemini-1.5-flash` | Very fast | Moderate |
| `gemini-1.5-pro` | Moderate | High |
| Custom | — | — |

---

## License

MIT
