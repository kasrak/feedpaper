import { useState } from "react";

export function useLocalStorageState<T>(
    key: string,
    defaultValue: T,
): [T, (value: T) => void] {
    const [state, _setState] = useState<T>(() => {
        try {
            const item =
                typeof window !== "undefined"
                    ? window.localStorage.getItem(key)
                    : undefined;
            return item ? JSON.parse(item) : defaultValue;
        } catch (error) {
            console.error(error);
            return defaultValue;
        }
    });
    return [
        state,
        (newValue: T) => {
            window.localStorage.setItem(key, JSON.stringify(newValue));
            _setState(newValue);
        },
    ];
}
