export const BASE_URL = "http://localhost:2345";

export function checkIfPlainRetweet(tweet: any): boolean {
    const result =
        tweet.retweeted_tweet &&
        tweet.full_text.startsWith(
            `RT @${tweet.retweeted_tweet.user.screen_name}: `,
        );
    return result;
}
