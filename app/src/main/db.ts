import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sqlite3 from "sqlite3";

import terminate from "./terminate";

// Create a ~/.feedpaper directory if it doesn't exist
const homeDir = os.homedir();
const feedpaperDir = path.join(homeDir, ".feedpaper");
if (!fs.existsSync(feedpaperDir)) {
    fs.mkdirSync(feedpaperDir);
}
const db = new (sqlite3.verbose().Database)(
    path.join(feedpaperDir, "db.sqlite"),
    (err) => {
        if (err) {
            terminate(`Could not connect to database: ${err.message}`);
        }
    },
);

type SqlValue = string | number | boolean | null;

export function sqlRun(
    sql: string,
    params: Array<SqlValue>,
): Promise<{
    lastId: number;
    changes: number;
}> {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) {
                reject(err);
            } else {
                resolve({
                    // lastID: value of last inserted row ID. only contains valid information when the query was an INSERT.
                    // changes: number of rows affected. only contains valid information when the query was an UPDATE or DELETE.
                    lastId: this.lastID,
                    changes: this.changes,
                });
            }
        });
    });
}

function identity<T>(x: T): T {
    return x;
}

export function sqlQuery<RowT>(
    sql: string,
    params: Array<SqlValue>,
    // TODO: ideally the row type would be Record<string, SqlValue>
    rowFormatter: (row: any) => RowT = identity,
): Promise<Array<RowT>> {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                const formattedRows = rows.map(rowFormatter);
                resolve(formattedRows);
            }
        });
    });
}

export function sqlDate(value: string): Date | null {
    return value ? new Date(value) : null;
}

export function sqlJson(value: string): any | null {
    return value ? JSON.parse(value) : null;
}

export const dbSchema = {
    items: (row) => ({
        id: row.id,
        created_at: sqlDate(row.created_at),
        content: sqlJson(row.content),
        enrichment: sqlJson(row.enrichment),
    }),
    settings: (row) => ({
        key: row.key,
        value: sqlJson(row.value),
    }),
    enrichments: (row) => ({
        id: row.id,
        started_at: sqlDate(row.started_at),
        updated_at: sqlDate(row.updated_at),
        finished_at: sqlDate(row.finished_at),
        result: sqlJson(row.result),
    }),
};
