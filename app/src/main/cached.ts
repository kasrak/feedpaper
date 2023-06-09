import crypto from "crypto";
import fs from "fs";
import path from "path";
import util from "util";
import os from "os";

const readFile = util.promisify(fs.readFile);
const writeFile = util.promisify(fs.writeFile);

function hash(str: string) {
    return crypto.createHash("sha1").update(str).digest("hex");
}

export function cached<T extends (...args: any[]) => any>(func: T) {
    let funcName = func.name;
    if (!funcName) {
        funcName = new Error().stack.split("\n")[2].trim().split(" ")[1];
    }
    return async (...args: Parameters<T>): Promise<ReturnType<T>> => {
        const cacheKey = `${funcName}_${hash(
            JSON.stringify([func.toString(), args]),
        )}`;
        const cacheFilePath = path.join(os.tmpdir(), `${cacheKey}.json`);
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
