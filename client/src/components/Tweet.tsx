import { getTweetKeys } from "@/pages";
import { TweetCardT, checkIfPlainRetweet, getTweetCard } from "@/utils/twitter";
import { groupBy } from "lodash";
import Link from "next/link";
import React from "react";
import { useState } from "react";
import { HeartIcon } from "@heroicons/react/20/solid";

function formatNumber(n: number): string {
    if (n < 1000) {
        return n.toLocaleString();
    } else {
        return (n / 1000).toFixed(1) + "K";
    }
}

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
            className="rounded mt-2 w-1/2 max-h-72 object-cover object-left-top border border-gray-200"
        />
    );
}

const supportedCardNames = new Set([
    "summary",
    "player",
    "summary_large_image",
]);

function TweetCard({ card }: { card: TweetCardT }) {
    if (!supportedCardNames.has(card.name)) {
        // Polls are not supported.
        return null;
    }

    const thumbnail =
        card.attributes.get("thumbnail_image_large") ||
        card.attributes.get("player_image");
    const description = card.attributes.get("description");
    const title = card.attributes.get("title");
    const domain = card.attributes.get("domain");

    return (
        <a
            href={card.url}
            target="_blank"
            rel="noopener noreferrer"
            className="border rounded-lg flex overflow-hidden mt-3 hover:bg-slate-50 h-28"
        >
            {thumbnail && (
                <img
                    src={thumbnail.image_value.url}
                    className="w-28 h-28 object-cover border-r"
                />
            )}
            <div className="flex flex-col justify-center text-sm overflow-hidden p-4">
                <div className="text-gray-600 shrink-0">
                    {domain && domain.string_value}
                </div>
                <div className="truncate shrink-0">
                    {title && title.string_value}
                </div>
                <div className="text-gray-600 overflow-hidden">
                    {description && description.string_value}
                </div>
            </div>
        </a>
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

    // The entities have indices into the full text, but they seem to be
    // off when there are multiple entities. I'm not sure how they're counting
    // indices, so we just replace text matches instead.
    let i = 0;
    for (const entity of entities.urls) {
        textParts = replaceFirst(
            textParts,
            entity.url,
            <a
                key={i++}
                href={entity.expanded_url}
                className="text-sky-600 hover:underline"
                target="_blank"
                rel="noopener noreferrer"
            >
                {entity.display_url}
            </a>,
        );
    }
    for (const entity of entities.user_mentions) {
        textParts = replaceFirst(
            textParts,
            `@${entity.screen_name}`,
            <Mention
                key={i++}
                name={entity.name}
                screen_name={entity.screen_name}
            />,
        );
    }

    // Merge media entities with extended media entities.
    const extendedMedia = data.extended_entities?.media || [];
    const mediaById = new Map<string, any>();
    for (const m of entities.media || []) {
        mediaById.set(m.id_str, {
            ...m,
            ...extendedMedia.find((xm: any) => xm.id_str === m.id_str),
        });
    }
    for (const m of extendedMedia) {
        if (!mediaById.has(m.id_str)) {
            mediaById.set(m.id_str, m);
        }
    }
    const mediaByUrl: Record<string, Array<any>> = groupBy(
        Array.from(mediaById.values()),
        (m: any) => m.url,
    );
    for (const [url, media] of Object.entries(mediaByUrl)) {
        textParts = replaceFirst(
            textParts,
            url,
            <div className="flex gap-1 overflow-auto" key={i++}>
                {media.map((m) => (
                    <Media key={i++} entity={m} />
                ))}
            </div>,
        );
    }
    return <>{textParts}</>;
};

export default function Tweet(props: {
    tweet: any;
    shrink?: boolean;
    isDebug: boolean;
}) {
    const { tweet, isDebug } = props;

    const [showNote, setShowNote] = useState(false);
    const [unshrink, setUnshrink] = useState(false);

    const debugBox = isDebug && tweet.enrichment && (
        <div className="mt-1 text-xs text-gray-500 font-mono">
            {Object.entries(tweet.enrichment).map(([key, value]) => (
                <div key={key}>
                    <span>{key}:</span>
                    <span>{JSON.stringify(value)}</span>
                </div>
            ))}
        </div>
    );
    const onDoubleClick = (e: React.MouseEvent) => {
        console.log("tweet", tweet);
        console.log("keys", getTweetKeys(tweet));
        // Don't also log the parent tweet in case we're a quoted tweet.
        e.stopPropagation();
    };

    const tweetCard = getTweetCard(tweet);

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
            onDoubleClick={onDoubleClick}
        >
            {tweet.retweeted_by && (
                <div className="flex text-gray-600 pb-1">
                    {tweet.retweeted_by.map((user: any, i: number) => (
                        <React.Fragment key={i}>
                            {i > 0 && <span className="mr-1">, </span>}
                            <a
                                href={`https://twitter.com/${user.screen_name}`}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="flex items-center hover:underline"
                            >
                                <span className="font-medium">{user.name}</span>
                            </a>
                        </React.Fragment>
                    ))}
                    <span className="ml-1">retweeted</span>
                </div>
            )}
            <a
                href={`https://twitter.com/${tweet.user.screen_name}/status/${tweet.id}`}
                target="_blank"
                rel="noreferrer noopener"
                className="flex items-center hover:bg-[rgba(138,189,226,0.33)] rounded-sm px-1 py-0.5 mx-[-0.25rem]"
            >
                <span className="font-medium truncate">{tweet.user.name}</span>
                <small className="ml-1 text-gray-600">
                    @{tweet.user.screen_name}
                </small>
                <span className="mx-1">·</span>
                <small className="text-gray-600">
                    {new Date(tweet.created_at).toLocaleDateString()}
                </small>
            </a>
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
            {tweet.retweeted_tweet && (
                <div className="border border-gray-300 rounded-lg my-2 overflow-hidden">
                    <Tweet
                        tweet={tweet.retweeted_tweet}
                        shrink={true}
                        isDebug={true}
                    />
                </div>
            )}
            {tweet.quoted_tweet && (
                <div className="border border-gray-300 rounded-lg my-2 overflow-hidden">
                    <Tweet
                        tweet={tweet.quoted_tweet}
                        shrink={true}
                        isDebug={true}
                    />
                </div>
            )}
            {tweetCard && <TweetCard card={tweetCard} />}
            {props.shrink && !unshrink && (
                <div className="absolute inset-0 bg-gradient-to-b from-transparent to-[rgba(255,255,255,0.8)] pointer-events-none"></div>
            )}
            <div className="flex items-center text-gray-500 mt-1">
                <HeartIcon className="w-4 h-4 mr-1" />
                {formatNumber(tweet.favorite_count + tweet.retweet_count)}
            </div>
            {debugBox}
        </div>
    );
}
