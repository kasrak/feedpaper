import { ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

/// Helper for conditionally adding Tailwind classes
export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}
