const http = require("http");
const { client, query } = require("./db");

async function main() {
    const res = await query("SELECT * FROM items");
    console.log(res.rows);

    process.exit(0);
}

main();
