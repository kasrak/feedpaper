/** @type {import('tailwindcss').Config} */
module.exports = {
    content: [
        "./src/**/*.{js,ts,jsx,tsx}",
        "./node_modules/@parssa/universal-ui/src/components/**/*.{ts,tsx,js,jsx}",
    ],
    theme: {
        extend: {},
    },
    plugins: [require("@parssa/universal-ui/src/plugin")],
};
