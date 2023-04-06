import { checkIfPlainRetweet } from "@/helpers";
import { getTweetKeys } from "@/pages";
import sortBy from "lodash/sortBy";
import Link from "next/link";
import { useState } from "react";

function Mention({ name, screen_name }: { name: string; screen_name: string }) {
    return (
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
}

function Media({ entity }: { entity: any }) {
    return (
        <img
            src={entity.media_url_https}
            alt={entity.display_url}
            className="rounded mt-2 w-1/2 max-h-72 object-contain border border-gray-200"
        />
    );
}

function replaceFirst(
    seq: Array<React.ReactNode>,
    find: string,
    replacement: React.ReactNode,
): Array<React.ReactNode> {
    const result = [];
    for (const part of seq) {
        if (typeof part === "string") {
            const matchIndex = part.toLowerCase().indexOf(find.toLowerCase());
            if (matchIndex !== -1) {
                result.push(part.slice(0, matchIndex));
                result.push(replacement);
                result.push(part.slice(matchIndex + find.length));
                result.push(...seq.slice(seq.indexOf(part) + 1));
                return result;
            } else {
                result.push(part);
            }
        } else {
            result.push(part);
        }
    }
    return result;
}

const getText = (data: any, opts: { showNote: boolean }) => {
    const { full_text, note_tweet } = data;

    let textParts =
        note_tweet && opts.showNote ? [note_tweet.text] : [full_text];
    const entities =
        note_tweet && opts.showNote ? note_tweet.entity_set : data.entities;

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

    // The entities have indices into the full text, but they seem to be
    // off when there are multiple entities. I'm not sure how they're counting
    // indices, so we just replace text matches instead.
    mergedEntities.forEach((entity, i) => {
        switch (entity.type) {
            case "user_mention":
                textParts = replaceFirst(
                    textParts,
                    `@${entity.screen_name}`,
                    <Mention
                        key={i}
                        name={entity.name}
                        screen_name={entity.screen_name}
                    />,
                );
                break;
            case "photo":
                textParts = replaceFirst(
                    textParts,
                    entity.url,
                    <Media key={i} entity={entity} />,
                );
                break;
            case "url":
                textParts = replaceFirst(
                    textParts,
                    entity.url,
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
            default:
                console.warn("Unknown entity type", entity);
        }
    });
    return <>{textParts}</>;
};

export default function Tweet(props: { tweet: any; shrink?: boolean }) {
    const { tweet } = props;

    const [showNote, setShowNote] = useState(false);
    const [unshrink, setUnshrink] = useState(false);

    const isPlainRetweet = checkIfPlainRetweet(tweet);

    if (isPlainRetweet) {
        return (
            <div
                onDoubleClick={(e) => {
                    console.log({ tweet, keys: getTweetKeys(tweet) });
                    // Don't also log the parent tweet.
                    e.stopPropagation();
                }}
            >
                <div className="flex pt-4 px-4 text-gray-600 mb-[-0.5em]">
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
            className="p-4 relative"
            style={
                props.shrink && !unshrink
                    ? {
                          maxHeight: "80px",
                          overflow: "hidden",
                      }
                    : undefined
            }
            onMouseEnter={() => {
                setUnshrink(true);
            }}
            onMouseLeave={() => {
                setUnshrink(false);
            }}
            onDoubleClick={(e) => {
                console.log({ tweet, keys: getTweetKeys(tweet) });
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
                <>
                    <div className="whitespace-pre-wrap break-words">
                        {getText(tweet, { showNote })}{" "}
                    </div>
                    {tweet.note_tweet && (
                        <button
                            className="text-sky-600"
                            onClick={() => setShowNote(!showNote)}
                        >
                            Show{showNote ? " less" : " more"}
                        </button>
                    )}
                </>
            )}
            {tweet.retweeted_tweet && (
                <div className="border border-gray-300 rounded-lg my-2 overflow-hidden">
                    <Tweet tweet={tweet.retweeted_tweet} shrink={true} />
                </div>
            )}
            {tweet.quoted_tweet && (
                <div className="border border-gray-300 rounded-lg my-2 overflow-hidden">
                    <Tweet tweet={tweet.quoted_tweet} shrink={true} />
                </div>
            )}
            {props.shrink && !unshrink && (
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[rgba(255,255,255,0.8)] pointer-events-none"></div>
            )}
        </div>
    );
}
