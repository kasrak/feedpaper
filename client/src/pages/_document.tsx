import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
    return (
        <Html lang="en" style={{ background: "#fff", filter: "invert(100%)" }}>
            <Head />
            <body>
                <Main />
                <NextScript />
            </body>
        </Html>
    );
}
