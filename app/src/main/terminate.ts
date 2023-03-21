export default function terminate(message: string): never {
    console.error(message);
    process.exit(1);
}
