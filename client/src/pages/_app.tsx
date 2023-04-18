import "@/styles/globals.css";
import type { AppProps } from "next/app";
import { QueryClient, QueryClientProvider } from "react-query";
import { NextAdapter } from "next-query-params";
import { QueryParamProvider } from "use-query-params";
import { UniversalUIConfigProvider } from "@parssa/universal-ui";

const queryClient = new QueryClient();

export default function App({ Component, pageProps }: AppProps) {
    return (
        <UniversalUIConfigProvider>
            <QueryParamProvider adapter={NextAdapter}>
                <QueryClientProvider client={queryClient}>
                    <Component {...pageProps} />
                </QueryClientProvider>
            </QueryParamProvider>
        </UniversalUIConfigProvider>
    );
}
