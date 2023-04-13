import crypto from "crypto";
import fs from "fs";
import path from "path";
import util from "util";
import os from "os";
import sqlite3 from "sqlite3";
import websocket from "websocket";

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

function hash(str: string) {
    return crypto.createHash("sha1").update(str).digest("hex");
}

const wsClient = new websocket.client();
let _ws: websocket.connection | null = null;
let _messageQueue: Array<string> = [];
wsClient.on("connect", (ws) => {
    if (_messageQueue.length) {
        for (const message of _messageQueue) {
            ws.sendUTF(message);
        }
        _messageQueue = [];
    }
    _ws = ws;
});
wsClient.connect("ws://localhost:5667");
function wsSend(message: string) {
    if (_ws) {
        _ws.sendUTF(message);
    } else {
        _messageQueue.push(message);
    }
}

type EncodedValue = string | void;
function encodeValue(value: any): EncodedValue {
    // TODO: make this handle non-JSON-encodable values
    return JSON.stringify(value);
}

let _traceCounter = 0;
export function trace<T extends (...args: any[]) => any>(func: T) {
    return (...args: Parameters<T>): ReturnType<T> => {
        _traceCounter++;
        pushOutputItem({
            type: "traceStart",
            traceId: _traceCounter,
            functionName: func.name,
            args: args.map((arg) => encodeValue(arg)),
        });
        let result, error;
        try {
            result = func(...args);
        } catch (err) {
            error = err;
        }
        pushOutputItem({
            type: "traceEnd",
            traceId: _traceCounter,
            returnValue: encodeValue(result),
            error: error ? encodeValue(error) : undefined,
        });
        if (error) {
            throw error;
        }
        return result;
    };
}

export function traceCached<T extends (...args: any[]) => any>(func: T) {
    return async (...args: Parameters<T>): Promise<ReturnType<T>> => {
        _traceCounter++;
        pushOutputItem({
            type: "traceStart",
            traceId: _traceCounter,
            functionName: func.name,
            args: args.map((arg) => encodeValue(arg)),
        });
        const cacheKey = `${func.name}_${hash(
            JSON.stringify([func.toString(), args]),
        )}`;
        const cacheFilePath = path.join("/tmp", `${cacheKey}.json`);
        try {
            const cachedData = await readFile(cacheFilePath, {
                encoding: "utf8",
            });
            const { result } = JSON.parse(cachedData);
            pushOutputItem({
                type: "traceEnd",
                traceId: _traceCounter,
                returnValue: encodeValue(result),
                error: undefined,
            });
            return result as ReturnType<T>;
        } catch (err) {
            if ((err as any).code === "ENOENT") {
                let result, error;
                try {
                    result = await func(...args);
                } catch (err) {
                    error = err;
                }
                pushOutputItem({
                    type: "traceEnd",
                    traceId: _traceCounter,
                    returnValue: encodeValue(result),
                    error: error ? encodeValue(error) : undefined,
                });
                if (error) {
                    throw error;
                }
                await writeFile(
                    cacheFilePath,
                    JSON.stringify({
                        result,
                    }),
                );
                return result;
            } else {
                pushOutputItem({
                    type: "traceEnd",
                    traceId: _traceCounter,
                    returnValue: undefined,
                    error: err,
                });
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

type OutputItemInfo =
    | {
          type: "programStart";
      }
    | {
          type: "table";
          data: any;
          columns?: Array<string>;
      }
    | {
          type: "log";
          level: "info" | "warn" | "error";
          message: Array<EncodedValue>;
      }
    | {
          type: "error";
          message: string;
          stack: string;
      }
    | {
          type: "traceStart";
          traceId: number;
          functionName: string;
          args: Array<EncodedValue>;
      }
    | {
          type: "traceEnd";
          traceId: number;
          returnValue: EncodedValue;
          error: EncodedValue;
      };
type OutputItem = { time: number; info: OutputItemInfo };

let _scriptStartTime = Date.now();
let _outputContext: Array<OutputItem> = [];
function pushOutputItem(info: OutputItemInfo) {
    const item = {
        time: Date.now() - _scriptStartTime,
        info,
    };
    _outputContext.push(item);
    wsSend(JSON.stringify(item));
}

export function run(main: () => Promise<void>) {
    let _skipLog = false;
    const originalConsoleLog = console.log;
    console.log = (...args: any[]) => {
        if (!_skipLog) {
            pushOutputItem({
                type: "log",
                level: "info",
                message: args.map((arg) => encodeValue(arg)),
            });
        }
        originalConsoleLog.apply(console, args);
    };
    const originalConsoleError = console.error;
    console.log = (...args: any[]) => {
        if (!_skipLog) {
            pushOutputItem({
                type: "log",
                level: "error",
                message: args.map((arg) => encodeValue(arg)),
            });
        }
        originalConsoleError.apply(console, args);
    };
    const originalConsoleTable = console.table;
    console.table = (data: any, columns?: Array<string>) => {
        pushOutputItem({
            type: "table",
            data,
            columns,
        });
        // console.table calls console.log under the hood, but we should
        // skip sending that because it'd be redundant.
        _skipLog = true;
        originalConsoleTable.apply(console, [data, columns]);
        _skipLog = false;
    };

    let err: Error | null = null;
    pushOutputItem({
        type: "programStart",
    });
    main()
        .catch((_err) => {
            pushOutputItem({
                type: "error",
                message: _err.message,
                stack: _err.stack || "",
            });
            err = _err;
        })
        .finally(() => {
            const dumpFilename = path.join(
                os.tmpdir(),
                `dump-${_scriptStartTime}.json`,
            );
            fs.writeFileSync(
                dumpFilename,
                JSON.stringify(_outputContext, null, 2),
            );
            console.info("Output written to", dumpFilename);
            if (err) {
                console.error(err);
                process.exit(1);
            }
            _ws?.close();
        });
}
