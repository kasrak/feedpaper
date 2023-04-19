import { dbSchema, sqlQuery } from "./db";

export default async function getSettings(): Promise<Record<string, any>> {
    const settingsRows = await sqlQuery(
        `SELECT * FROM settings`,
        [],
        dbSchema.settings,
    );
    const settings = {};
    for (const row of settingsRows) {
        settings[row.key] = row.value;
    }
    return settings;
}
