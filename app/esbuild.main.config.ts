import { BuildOptions } from "esbuild";
import * as path from "path";

const config: BuildOptions = {
    platform: "node",
    entryPoints: [
        path.resolve("src/main/main.ts"),
        path.resolve("src/main/preload.ts"),
    ],
    external: ["pg", "sqlite3"],
    bundle: true,
    target: "node16.15.0", // electron version target
};

export default config;
