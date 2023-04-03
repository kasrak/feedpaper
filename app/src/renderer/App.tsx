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
                    height: 55,
                    width: "100%",
                }}
            >
                <button
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
