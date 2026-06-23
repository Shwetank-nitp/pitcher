import axios from 'axios';

export async function getTwitterUserId(accessToken) {
  try {
    const response = await axios.get('https://api.twitter.com/2/users/me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    // Twitter v2 me response is {"data": {"id": "12345", "name": "...", "username": "..."}}
    return response.data.data.id;
  } catch (err) {
    const errorMsg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`Failed to fetch Twitter profile: ${errorMsg}`);
  }
}

export async function publishToTwitter(accessToken, text) {
  try {
    const response = await axios.post(
      'https://api.twitter.com/2/tweets',
      { text },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      }
    );
    // Twitter v2 create tweet response is {"data": {"id": "TWEET_ID", "text": "..."}}
    return response.data.data.id;
  } catch (err) {
    const errorMsg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`Failed to post tweet: ${errorMsg}`);
  }
}

export async function deleteTwitterTweet(accessToken, tweetId) {
  try {
    await axios.delete(`https://api.twitter.com/2/tweets/${tweetId}`, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });
    return true;
  } catch (err) {
    const errorMsg = err.response?.data ? JSON.stringify(err.response.data) : err.message;
    throw new Error(`Failed to delete tweet: ${errorMsg}`);
  }
}
