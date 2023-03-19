/** @type {import('tailwindcss').Config} */
module.exports = {
    mode: "jit",
    content: ["./src/**/*.tsx"],
    theme: {
        extend: {},
    },
    plugins: [require("tailwindcss-animate")],
};
