import axios from 'axios';

const BSKY_API = 'https://bsky.social/xrpc';
const MAX_GRAPHEMES = 295; // leave 5 chars buffer below the 300 limit

// ─── Auth ────────────────────────────────────────────────────────────────────

/**
 * Authenticate with Bluesky using a handle and App Password.
 * Returns session data: { accessJwt, refreshJwt, did, handle }
 */
export async function loginBluesky(identifier, appPassword) {
  try {
    const res = await axios.post(`${BSKY_API}/com.atproto.server.createSession`, {
      identifier,
      password: appPassword
    });
    const { accessJwt, refreshJwt, did, handle } = res.data;
    return { accessJwt, refreshJwt, did, handle };
  } catch (err) {
    const errorMsg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`Failed to login to Bluesky: ${errorMsg}`);
  }
}

/**
 * Refresh Bluesky session using refresh token.
 * Returns updated session data.
 */
export async function refreshBlueskySession(refreshJwt) {
  try {
    const res = await axios.post(`${BSKY_API}/com.atproto.server.refreshSession`, {}, {
      headers: {
        Authorization: `Bearer ${refreshJwt}`
      }
    });
    const { accessJwt, refreshJwt: newRefreshJwt, did, handle } = res.data;
    return { accessJwt, refreshJwt: newRefreshJwt, did, handle };
  } catch (err) {
    const errorMsg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`Failed to refresh Bluesky session: ${errorMsg}`);
  }
}

// ─── Grapheme counting ────────────────────────────────────────────────────────

/**
 * Count graphemes (visual characters) in a string.
 * Falls back to string length if Intl.Segmenter is not available (Node < 16).
 */
function countGraphemes(text) {
  if (typeof Intl !== 'undefined' && Intl.Segmenter) {
    const segmenter = new Intl.Segmenter();
    return [...segmenter.segment(text)].length;
  }
  return text.length;
}

/**
 * Split text into chunks of at most maxGraphemes graphemes.
 * Tries to split at sentence boundaries ('. ') first, then word boundaries.
 */
function splitIntoChunks(text, maxGraphemes = MAX_GRAPHEMES) {
  if (countGraphemes(text) <= maxGraphemes) return [text];

  const chunks = [];
  let remaining = text;

  while (countGraphemes(remaining) > maxGraphemes) {
    // Try to find a good split point at or before maxGraphemes graphemes
    let splitAt = -1;

    // Walk grapheme by grapheme to find the cut position
    const segmenter = (typeof Intl !== 'undefined' && Intl.Segmenter)
      ? new Intl.Segmenter()
      : null;

    let charIdx = 0;
    let graphemeCount = 0;
    if (segmenter) {
      for (const seg of segmenter.segment(remaining)) {
        if (graphemeCount >= maxGraphemes) break;
        charIdx += seg.segment.length;
        graphemeCount++;
      }
    } else {
      charIdx = maxGraphemes;
    }

    const candidate = remaining.slice(0, charIdx);

    // Prefer splitting at '. ' sentence boundary
    const sentenceSplit = candidate.lastIndexOf('. ');
    if (sentenceSplit > maxGraphemes * 0.5) {
      splitAt = sentenceSplit + 1; // include the '.'
    } else {
      // Fall back to last space
      const spaceSplit = candidate.lastIndexOf(' ');
      splitAt = spaceSplit > 0 ? spaceSplit : charIdx;
    }

    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }

  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

// ─── Publish ─────────────────────────────────────────────────────────────────

/**
 * Publish a post to Bluesky. If text exceeds 300 graphemes, automatically
 * threads the post across multiple replies.
 *
 * @param {string} accessJwt
 * @param {string} did - The author's DID (e.g. "did:plc:xxx")
 * @param {string} text - The full post text
 * @returns {string} URI of the first post in the thread
 */
export async function publishToBluesky(accessJwt, did, text) {
  const chunks = splitIntoChunks(text);
  let rootRef = null;
  let parentRef = null;
  let firstUri = null;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks.length > 1
      ? `${chunks[i]}  [${i + 1}/${chunks.length}]`
      : chunks[i];

    const record = {
      '$type': 'app.bsky.feed.post',
      text: chunk,
      createdAt: new Date().toISOString()
    };

    // Add reply references for all chunks after the first
    if (parentRef && rootRef) {
      record.reply = {
        root: rootRef,
        parent: parentRef
      };
    }

    try {
      const res = await axios.post(
        `${BSKY_API}/com.atproto.repo.createRecord`,
        {
          repo: did,
          collection: 'app.bsky.feed.post',
          record
        },
        {
          headers: {
            Authorization: `Bearer ${accessJwt}`,
            'Content-Type': 'application/json'
          }
        }
      );

      const { uri, cid } = res.data;
      if (i === 0) {
        firstUri = uri;
        rootRef = { uri, cid };
      }
      parentRef = { uri, cid };
    } catch (err) {
      const errorMsg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
      throw new Error(`Failed to create post record (chunk ${i + 1}/${chunks.length}): ${errorMsg}`);
    }
  }

  return firstUri;
}

// ─── Delete ──────────────────────────────────────────────────────────────────

/**
 * Delete a Bluesky post by its AT URI.
 * @param {string} accessJwt
 * @param {string} did
 * @param {string} uri - The AT URI of the post (at://did.../app.bsky.feed.post/rkey)
 */
export async function deleteBlueskyPost(accessJwt, did, uri) {
  try {
    // Extract the rkey from the URI: at://did/collection/rkey
    const parts = uri.split('/');
    const rkey = parts[parts.length - 1];

    await axios.post(
      `${BSKY_API}/com.atproto.repo.deleteRecord`,
      {
        repo: did,
        collection: 'app.bsky.feed.post',
        rkey
      },
      {
        headers: {
          Authorization: `Bearer ${accessJwt}`,
          'Content-Type': 'application/json'
        }
      }
    );
  } catch (err) {
    const errorMsg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`Failed to delete Bluesky post: ${errorMsg}`);
  }
}
