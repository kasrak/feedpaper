import React from "react";

const styles = {
    button: {
        cursor: "pointer",
        backgroundColor: "transparent",
        color: "#234",
        fontWeight: "bold",
        fontSize: "1.2em",
        margin: "16px",
        padding: "8px",
        border: "none",
        borderBottom: "4px solid transparent",
    },
};

export function App() {
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
                        borderBottomColor: "rgb(74, 153, 233)",
                    }}
                    onClick={() => {
                        // send message to main process
                        (window as any).electron.sendMessageToMain("set-tab", {
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
                        borderBottomColor: "rgb(74, 153, 233)",
                    }}
                >
                    Twitter
                </button>
            </div>
        </div>
    );
}
