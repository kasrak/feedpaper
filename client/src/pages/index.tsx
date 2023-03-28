import Head from "next/head";
import { useQuery } from "react-query";
import Tweet from "@/components/Tweet";

async function fetchRecentItems() {
    const res = await fetch("http://localhost:8888/getItems");
    return res.json();
}

function Tweets(props: { items: Array<any> }) {
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
    const query = useQuery("recentItems", fetchRecentItems);
    return (
        <>
            <Head>
                <title>Feedpaper</title>
            </Head>
            <main>
                {query.isLoading && (
                    <div className="flex items-center justify-center p-4">
                        Loading...
                    </div>
                )}
                {query.data && (
                    <div className="max-w-[620px] mx-auto border-l border-r border-gray-300">
                        <Tweets items={query.data.items} />
                    </div>
                )}
            </main>
        </>
    );
}
