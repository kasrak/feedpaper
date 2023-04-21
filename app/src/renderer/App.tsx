import React, { useEffect, useState } from "react";

const electron = (window as any).electron;

const styles = {
    button: {
        backgroundColor: "transparent",
        cursor: "pointer",
        color: "#234",
        fontWeight: "bold",
        fontSize: "1.2em",
        margin: "16px",
        padding: "8px",
        border: "none",
        borderBottom: "4px solid transparent",
    },
    link: {
        backgroundColor: "transparent",
        cursor: "pointer",
        color: "rgb(74, 153, 233)",
        fontWeight: "bold",
        fontSize: "1.2em",
        margin: "16px",
        padding: "8px",
        border: "none",
    },
};

export function App() {
    const [selectedTab, setSelectedTab] = useState("feedpaper");
    useEffect(() => {
        const callback = (data: any) => {
            setSelectedTab(data.tab);
        };
        electron.on("selected-tab-changed", callback);
        return () => {
            electron.off("selected-tab-changed", callback);
        };
    }, []);

    return (
        <div>
            <div
                style={{
                    display: "flex",
                    justifyContent: "stretch",
                    alignItems: "center",
                    height: 56,
                    width: "100%",
                    borderBottom: "1px solid rgba(0,0,0,0.2)",
                }}
            >
                <button
                    style={{
                        ...styles.button,
                        borderBottomColor:
                            selectedTab === "feedpaper"
                                ? "rgb(74, 153, 233)"
                                : "transparent",
                    }}
                    onClick={() => {
                        // send message to main process
                        electron.sendMessageToMain("set-tab", {
                            tab: "feedpaper",
                        });
                    }}
                >
                    Feedpaper
                </button>
                <button
                    onClick={() => {
                        // send message to main process
                        (window as any).electron.sendMessageToMain("set-tab", {
                            tab: "twitter",
                        });
                    }}
                    style={{
                        ...styles.button,
                        borderBottomColor:
                            selectedTab === "twitter"
                                ? "rgb(74, 153, 233)"
                                : "transparent",
                    }}
                >
                    Twitter
                </button>
                <div style={{ flexGrow: 1 }} />
                <button
                    style={styles.link}
                    onClick={() => {
                        (window as any).electron.sendMessageToMain(
                            "open-in-browser",
                        );
                    }}
                >
                    Open in browser
                </button>
            </div>
        </div>
    );
}
