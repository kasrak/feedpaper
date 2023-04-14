export function checkIfPlainRetweet(tweet: any): boolean {
    const result =
        tweet.retweeted_tweet &&
        tweet.full_text.startsWith(
            `RT @${tweet.retweeted_tweet.user.screen_name}: `,
        );
    return result;
}

export type TweetCardT = {
    name: string;
    url: string;
    attributes: Map<string, any>;
};
export function getTweetCard(tweet: any): TweetCardT | null {
    if (!tweet.card) {
        return null;
    }
    const card: TweetCardT = {
        name: tweet.card.legacy.name,
        url: tweet.card.legacy.url,
        attributes: new Map(),
    };
    if (tweet.card.legacy.binding_values) {
        for (const binding of tweet.card.legacy.binding_values) {
            card.attributes.set(binding.key, binding.value);
        }
    }
    return card;
}
