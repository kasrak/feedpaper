import sortBy from "lodash/sortBy";
import Link from "next/link";

const Mention = ({
    name,
    screen_name,
}: {
    name: string;
    screen_name: string;
}) => (
    <a
        href={`https://twitter.com/${screen_name}`}
        className="text-sky-600 hover:underline"
        target="_blank"
        rel="noopener noreferrer"
        title={name}
    >
        @{screen_name}
    </a>
);

const getText = (data: any) => {
    const { full_text, entities } = data;

    const mergedEntities = sortBy(
        [
            ...entities.urls.map((url: any) => ({
                type: "url",
                ...url,
            })),
            ...entities.user_mentions.map((user_mention: any) => ({
                type: "user_mention",
                ...user_mention,
            })),
            // TODO: also look at extended_media for alt text and mp4s
            ...(entities.media || []).map((media: any) => ({
                type: "media",
                ...media,
            })),
        ],
        (entity) => entity.indices[0],
    );

    const textParts = [];
    let currentIndex = 0;

    mergedEntities.forEach((entity, i) => {
        textParts.push(full_text.slice(currentIndex, entity.indices[0]));
        switch (entity.type) {
            case "url":
                textParts.push(
                    <a
                        key={i}
                        href={entity.expanded_url}
                        className="text-sky-600 hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                    >
                        {entity.display_url}
                    </a>,
                );
                break;
            case "user_mention":
                textParts.push(
                    <Mention
                        key={i}
                        name={entity.name}
                        screen_name={entity.screen_name}
                    />,
                );
                break;
            case "photo": {
                textParts.push(<img src={entity.media_url_https} key={i} />);
                break;
            }
            default:
                console.warn("Unknown entity type", entity);
        }
        currentIndex = entity.indices[1];
    });
    textParts.push(full_text.slice(currentIndex));

    // TODO: allow expanding when there's a note_

    return <>{textParts}</>;
};

export default function Tweet(props: { tweet: any }) {
    const { tweet } = props;

    const isPlainRetweet =
        tweet.retweeted_tweet &&
        tweet.full_text.startsWith(
            `RT @${tweet.retweeted_tweet.user.screen_name}: `,
        );

    if (isPlainRetweet) {
        return (
            <div
                onDoubleClick={(e) => {
                    console.log(tweet);
                    // Don't also log the parent tweet.
                    e.stopPropagation();
                }}
            >
                <div className="flex pt-4 px-4 text-gray-600">
                    <a
                        href={`https://twitter.com/${tweet.user.screen_name}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="flex items-center hover:underline mr-1"
                    >
                        <span className="font-medium">{tweet.user.name}</span>
                    </a>
                    retweeted:
                </div>
                <Tweet tweet={tweet.retweeted_tweet} />
            </div>
        );
    }

    return (
        <div
            className="p-4"
            onDoubleClick={(e) => {
                console.log(tweet);
                // Don't also log the parent tweet.
                e.stopPropagation();
            }}
        >
            <div className="flex items-center">
                <a
                    href={`https://twitter.com/${tweet.user.screen_name}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="flex items-center hover:underline overflow-hidden"
                >
                    <span className="font-medium truncate">
                        {tweet.user.name}
                    </span>
                    <small className="ml-1 text-gray-600">
                        @{tweet.user.screen_name}
                    </small>
                </a>
                <span className="mx-1">
                    <Link href={`/tweet/${tweet.id}`}>·</Link>
                </span>
                <a
                    href={`https://twitter.com/${tweet.user.screen_name}/status/${tweet.id}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="hover:underline"
                >
                    <small className="text-gray-600">
                        {new Date(tweet.created_at).toLocaleDateString()}
                    </small>
                </a>
            </div>
            {!isPlainRetweet && (
                <div className="whitespace-pre-wrap">
                    {getText(tweet)}{" "}
                    {tweet.note_tweet && <a href="#">Show more</a>}
                </div>
            )}
            {tweet.retweeted_tweet && (
                <div className="border border-gray-300 rounded-lg my-2">
                    <Tweet tweet={tweet.retweeted_tweet} />
                </div>
            )}
            {tweet.quoted_tweet && (
                <div className="border border-gray-300 rounded-lg my-2">
                    <Tweet tweet={tweet.quoted_tweet} />
                </div>
            )}
        </div>
    );
}
