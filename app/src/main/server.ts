import express from "express";
import cors from "cors";
import path from "path";
import { sqlRun, sqlQuery, sqlJson, sqlDate, dbSchema } from "./db";
import enrichItems from "./enrichItems";
import getSettings from "./getSettings";
import { is } from "electron-util";

const HOSTNAME = "0.0.0.0";
const BACKEND_PORT = 2345;
export const BACKEND_BASE_URL = `http://${HOSTNAME}:${BACKEND_PORT}`;

export const FRONTEND_BASE_URL = is.development
    ? `http://localhost:2346`
    : BACKEND_BASE_URL;

export async function startServer() {
    function formatItem(row) {
        return {
            ...row,
            created_at: sqlDate(row["created_at"]).toISOString(),
            content: sqlJson(row["content"]),
            enrichment: sqlJson(row["enrichment"]),
        };
    }

    const server = express();
    server.use(cors());
    server.use(express.json({ limit: "50mb" }));

    server.post("/api/saveSettings", async (req, res) => {
        const { settings } = req.body;
        for (const [key, value] of Object.entries(settings)) {
            await sqlRun(
                "INSERT INTO settings (key, value)" +
                    " VALUES ($1, $2)" +
                    " ON CONFLICT (key)" +
                    " DO UPDATE SET value = $2",
                [key, JSON.stringify(value)],
            );
        }
        res.json({ ok: true });
    });

    server.get("/api/getSettings", async (req, res) => {
        const settings = await getSettings();
        res.json({ settings });
    });

    server.post("/api/saveItems", async (req, res) => {
        const { items } = req.body;
        for (const item of items) {
            await sqlRun(
                "INSERT INTO items (id, content)" +
                    " VALUES ($1, $2)" +
                    " ON CONFLICT (id)" +
                    " DO UPDATE SET content = $2",
                [item.id, JSON.stringify(item)],
            );
        }
        res.json({ ok: true });

        enrichItems();
    });

    function jsDateToSqlite(date: Date): string {
        return date.toISOString().replace("T", " ").replace("Z", "");
    }

    server.get("/api/getItems", async (req, res) => {
        const start = jsDateToSqlite(new Date(req.query["start"] as string));
        const end = jsDateToSqlite(new Date(req.query["end"] as string));
        const items = await sqlQuery(
            `SELECT * FROM items
                    WHERE created_at > $1 AND created_at < $2
                    AND content->'is_promoted' = 'false'
                    ORDER BY created_at, id ASC`,
            [start, end],
            formatItem,
        );
        res.json({ items });
    });

    server.get("/api/getItem", async (req, res) => {
        const items = await sqlQuery(
            "SELECT * FROM items WHERE id = $1",
            [req.query["id"] as string],
            formatItem,
        );
        res.json({ item: items[0] });
    });

    server.post("/api/enrichItems", async (req, res) => {
        res.json({ ok: true });
        enrichItems();
    });

    if (!is.development) {
        // In dist build, serve static files from ../client
        const staticDir = path.join(__dirname, "..", "client");
        console.log(`Serving static files from ${staticDir}`);
        server.use(express.static(staticDir));
    }

    server.listen(BACKEND_PORT, () => {
        console.log(`Backend server running at ${BACKEND_BASE_URL}`);
    });
}
