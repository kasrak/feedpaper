const http = require("http");
const { Client } = require("pg");

const client = new Client({
    host: "0.0.0.0",
    database: "feedpaper",
});
client.connect((err) => {
    if (err) {
        console.error("Database connection error", err.stack);
    } else {
        console.log("Connected to database");
    }
});

const hostname = "0.0.0.0";
const port = 8888;

const server = http.createServer(async (req, res) => {
    // if (req.method === "POST") {
    //     let body = "";
    //     req.on("data", (chunk) => {
    //         body += chunk.toString(); // convert Buffer to string
    //     });
    //     req.on("end", () => {
    //         client.query(
    //             "INSERT INTO feedpaper (url, title, description, image, date) VALUES ($1, $2, $3, $4, $5)",
    //             [
    //                 body.url,
    //                 body.title,
    //                 body.description,
    //                 body.image,
    //                 body.date,
    //             ],
    //             (err, res) => {
    //                 if (err) {
    //                     console.log(err.stack);
    //                 } else {
    //                     console.log(res.rows[0]);
    //                 }
    //             }
    //         );
    //     });
    // }

    console.log("INSERT");
    await client.query(
        "INSERT INTO items (tweet_id, created_at, content) VALUES ($1, $2, $3)",
        ["123", new Date().toISOString(), '{"test": true}'],
    );

    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain");
    res.end("Hello World");
});

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
});
