import express from "express";
import cors from "cors";
import path from "path";
import proxy from "express-http-proxy";

const { run, all, jsonValue, datetimeValue } = require("./db");

const HOSTNAME = "0.0.0.0";
const BACKEND_PORT = 2345;
export const BACKEND_BASE_URL = `http://${HOSTNAME}:${BACKEND_PORT}`;

const isDev = process.env.NODE_ENV === "development";
export const FRONTEND_BASE_URL = isDev
    ? `http://localhost:2346`
    : BACKEND_BASE_URL;

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

    if (!isDev) {
        // In dist build, serve static files from ../client
        const staticDir = path.join(__dirname, "..", "client");
        console.log(`Serving static files from ${staticDir}`);
        server.use(express.static(staticDir));
    }

    server.listen(BACKEND_PORT, () => {
        console.log(`Backend server running at ${BACKEND_BASE_URL}`);
    });
}
