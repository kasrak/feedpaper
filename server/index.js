// Basic Node.js server that returns "Hello World"
// Run with: node server/index.js
const http = require("http");

const hostname = "0.0.0.0";
const port = process.env.PORT;

const server = http.createServer((req, res) => {
    res.statusCode = 200;
    res.setHeader("Content-Type", "text/plain");
    res.end("Hello World");
});

server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
});
