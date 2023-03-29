import Head from "next/head";
import { useQuery } from "react-query";
import Tweet from "@/components/Tweet";
import { useState } from "react";

function toIsoDate(date: Date) {
    return date.toISOString().split("T")[0];
}

async function getItems(date: Date) {
    const start = toIsoDate(date);
    const end = toIsoDate(new Date(date.getTime() + 24 * 60 * 60 * 1000));
    const res = await fetch(
        `http://localhost:8888/getItems?start=${start}&end=${end}`,
    );
    return res.json();
}

function Tweets(props: { items: Array<any> }) {
    if (props.items.length === 0) {
        return (
            <div className="flex items-center justify-center p-4">No items</div>
        );
    }

    return (
        <div>
            {props.items.map((item) => {
                return (
                    <div
                        key={"tweet-" + item.id}
                        className="border-b border-b-gray-300"
                    >
                        <Tweet tweet={item.content} />
                    </div>
                );
            })}
        </div>
    );
}

export default function Home() {
    const [date, setDate] = useState(
        new Date(new Date().getTime() - 24 * 60 * 60 * 1000),
    );
    const query = useQuery(["items", toIsoDate(date)], () => getItems(date));

    return (
        <>
            <Head>
                <title>Feedpaper</title>
            </Head>
            <main>
                <div className="max-w-[620px] mx-auto border m-2 border-gray-300">
                    <div className="p-4 bg-gray-50 border-b border-b-gray-300 flex gap-4">
                        <h3 className="font-semibold text-lg text-gray-800 flex-grow">
                            {date.toLocaleDateString(undefined, {
                                weekday: "long",
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                            })}
                        </h3>
                        <button
                            onClick={() => {
                                setDate(
                                    new Date(
                                        date.getTime() - 24 * 60 * 60 * 1000,
                                    ),
                                );
                            }}
                        >
                            &larr;
                        </button>
                        <button
                            onClick={() => {
                                setDate(
                                    new Date(
                                        date.getTime() + 24 * 60 * 60 * 1000,
                                    ),
                                );
                            }}
                        >
                            &rarr;
                        </button>
                    </div>
                    {query.isLoading && !query.data && (
                        <div className="flex items-center justify-center p-4">
                            Loading...
                        </div>
                    )}
                    {query.data && <Tweets items={query.data.items} />}
                </div>
            </main>
        </>
    );
}
