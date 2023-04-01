const { Client } = require("pg");

const client = new Client({
    host: "0.0.0.0",
    database: "feedpaper",
});
client.connect((err) => {
    if (err) {
        console.error("Database connection error", err.stack);
    }
});

async function query(sql, params) {
    // console.log("query: ", sql, params);
    return client.query(sql, params);
}

module.exports = {
    client,
    query,
};
