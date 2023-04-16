import express from "express";
import cors from "cors";
import path from "path";

const { run, all, jsonValue, datetimeValue } = require("./db");

const HOSTNAME = "0.0.0.0";
export const PORT = 2345;
export const SERVER_URL = `http://${HOSTNAME}:${PORT}`;

export async function startServer() {
    function formatItem(row) {
        return {
            ...row,
            created_at: datetimeValue(row["created_at"]),
            content: jsonValue(row["content"]),
            enrichment: jsonValue(row["enrichment"]),
        };
    }

    const server = express();
    server.use(cors());
    server.use(express.json({ limit: "50mb" }));

    server.post("/api/saveItems", async (req, res) => {
        const { items } = req.body;
        for (const item of items) {
            await run(
                "INSERT INTO items (id, content)" +
                    " VALUES ($1, $2)" +
                    " ON CONFLICT (id)" +
                    " DO UPDATE SET content = $2",
                [item.id, JSON.stringify(item)],
            );
        }
        res.json({ ok: true });
    });

    server.get("/api/getItems", async (req, res) => {
        const items = await all(
            `SELECT * FROM items
                    WHERE created_at > $1 AND created_at < $2
                    AND content->'is_promoted' = 'false'
                    ORDER BY created_at, id ASC`,
            [req.query["start"], req.query["end"]],
            formatItem,
        );
        res.json({ items });
    });

    server.get("/api/getItem", async (req, res) => {
        const items = await all(
            "SELECT * FROM items WHERE id = $1",
            [req.query["id"]],
            formatItem,
        );
        res.json({ item: items[0] });
    });

    server.use(express.static(path.join(__dirname, "..", "client")));

    server.listen(PORT, () => {
        console.log(`Server running at ${SERVER_URL}`);
    });
}
