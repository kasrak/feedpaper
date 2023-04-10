import terminate from "./terminate";

const sqlite3 = require("sqlite3").verbose();
const fs = require("fs");
const os = require("os");
const path = require("path");

// Create a ~/.feedpaper directory if it doesn't exist
const homeDir = os.homedir();
const feedpaperDir = path.join(homeDir, ".feedpaper");
if (!fs.existsSync(feedpaperDir)) {
    fs.mkdirSync(feedpaperDir);
}
const db = new sqlite3.Database(path.join(feedpaperDir, "db.sqlite"), (err) => {
    if (err) {
        terminate(`Could not connect to database: ${err.message}`);
    }
});

async function run(sql: string, params: Array<any>) {
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

async function all(
    sql: string,
    params: Array<any>,
    postprocess?: (row: any) => any,
) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) {
                reject(err);
            } else {
                if (postprocess) {
                    rows = rows.map(postprocess);
                }
                resolve(rows);
            }
        });
    });
}

function jsonValue(value) {
    if (value === null || value === "") {
        return null;
    }
    return JSON.parse(value);
}

function datetimeValue(value) {
    if (value === null || value === "") {
        return null;
    }
    return new Date(value).toISOString();
}

module.exports = {
    run,
    all,
    jsonValue,
    datetimeValue,
};
