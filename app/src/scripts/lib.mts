import crypto from "crypto";
import fs from "fs";
import path from "path";
import util from "util";
import os from "os";
import sqlite3 from "sqlite3";

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

function hash(str: string) {
    return crypto.createHash("sha1").update(str).digest("hex");
}

export function trace<T extends (...args: any[]) => any>(func: T) {
    return (...args: Parameters<T>): ReturnType<T> => {
        const result = func(...args);
        return result;
    };
}

export function traceCached<T extends (...args: any[]) => any>(func: T) {
    return async (...args: Parameters<T>): Promise<ReturnType<T>> => {
        const cacheKey = `${func.name}_${hash(
            JSON.stringify([func.toString(), args]),
        )}`;
        const cacheFilePath = path.join("/tmp", `${cacheKey}.json`);
        try {
            const cachedData = await readFile(cacheFilePath, {
                encoding: "utf8",
            });
            const { result } = JSON.parse(cachedData);
            return result as ReturnType<T>;
        } catch (err) {
            if ((err as any).code === "ENOENT") {
                const result = await func(...args);
                await writeFile(
                    cacheFilePath,
                    JSON.stringify({
                        result,
                    }),
                );
                return result;
            } else {
                throw err;
            }
        }
    };
}

const homeDir = os.homedir();
const feedpaperDir = path.join(homeDir, ".feedpaper");
if (!fs.existsSync(feedpaperDir)) {
    fs.mkdirSync(feedpaperDir);
}
const db = new sqlite3.Database(path.join(feedpaperDir, "db.sqlite"), (err) => {
    if (err) {
        throw new Error(`Could not connect to database: ${err.message}`);
    }
});

function identity<T>(x: T): T {
    return x;
}

type SqlValue = string | number | boolean | null;

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

export function sqlDate(value: string): Date | null {
    return value ? new Date(value) : null;
}

export function sqlJson(value: string): any | null {
    return value ? JSON.parse(value) : null;
}

export function run(main: () => Promise<void>) {
    main().catch((err) => {
        console.error(err);
        process.exit(1);
    });
}
