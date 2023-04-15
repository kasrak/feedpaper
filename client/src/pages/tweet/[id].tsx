import Head from "next/head";
import { useQuery } from "react-query";
import Tweet from "@/components/Tweet";
import { useRouter } from "next/router";
import { BASE_URL } from "@/utils/base_url";
import { useLocalStorageState } from "@/utils/hooks";

async function fetchTweet(id: string) {
    if (!id) {
        return null;
    }
    const res = await fetch(`${BASE_URL}/api/getItem?id=${id}`);
    return res.json();
}

export default function TweetPage() {
    const router = useRouter();
    const { id } = router.query;
    const query = useQuery(["tweet", id], () => fetchTweet(id as string));
    const [isDebug] = useLocalStorageState("isDebug", false);
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
                    <div className="max-w-[620px] mx-auto border mt-2 border-gray-300 bg-white">
                        <Tweet
                            tweet={{
                                ...query.data.item.content,
                                enrichment: query.data.item.enrichment,
                            }}
                            isDebug={isDebug}
                        />
                    </div>
                )}
            </main>
        </>
    );
}
