import { BASE_URL } from "@/utils/base_url";
import { Button, Input, Dialog } from "@parssa/universal-ui";
import { debounce } from "lodash";
import { ChangeEvent, useState } from "react";

type SettingsT = {
    openaiApiKey: string;
    interests: string;
};

const saveSettings = debounce(async (settings: SettingsT) => {
    const res = await fetch(`${BASE_URL}/api/saveSettings`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ settings }),
    });
    if (!res.ok) {
        alert("Failed to save settings!");
        console.error(res);
    }
}, 200);

export default function Settings(props: {
    initialSettings: Partial<SettingsT>;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const [settings, _setSettings] = useState<SettingsT>({
        openaiApiKey: "",
        interests: "",
        ...props.initialSettings,
    });
    const setSetting = (key: keyof SettingsT, value: string) => {
        _setSettings((prev) => {
            const newSettings = { ...prev, [key]: value };
            saveSettings(newSettings);
            return newSettings;
        });
    };

    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <Dialog.Content>
                <Dialog.Title>Settings</Dialog.Title>
                <div className="flex flex-col gap-4 mt-4">
                    <label className="flex flex-col gap-1">
                        <div className="font-medium">OpenAI API key</div>
                        <div className="text-gray-800">
                            This will be used to group related Tweets and filter
                            out low relevance Tweets.
                        </div>
                        <div className="flex items-center">
                            <Input
                                className="w-full"
                                value={settings.openaiApiKey}
                                onChange={(e: ChangeEvent<HTMLInputElement>) =>
                                    setSetting("openaiApiKey", e.target.value)
                                }
                            />
                            <a
                                href="https://platform.openai.com/account/api-keys"
                                className="text-sky-700 shrink-0 ml-4"
                                target="_blank"
                                rel="noopener noreferrer"
                            >
                                Get a key &rarr;
                            </a>
                        </div>
                    </label>
                    <label className="flex flex-col gap-1">
                        <div className="font-medium">Your interests</div>
                        <div className="text-gray-800">
                            Enter a comma-separated list of topics and keywords
                            you&apos;re interested in. This will be used to rank
                            Tweets and filter out low relevance Tweets.
                        </div>
                        <div className="enabled:hover:transition-colors enabled:focus:transition-colors tracking-tight rounded border disabled:opacity-75 disabled:cursor-not-allowed focus:outline-none ring-0 focus-within:relative transition-[ring] focus-within:z-20 focus:ring focus-within:ring focus:ring-theme-base/50 focus-within:ring-theme-base/50 font-normal placeholder:opacity-50 truncate flex items-center pl-size-x pr-size-x pt-size-y pb-size-y text-size leading-size text-theme-base placeholder:text-theme-muted group-data-[uui=true]/card:border-theme-base bg-theme-pure border-theme-base w-full">
                            <textarea
                                className="bg-transparent focus:outline-none placeholder:text-theme-muted placeholder:opacity-50 w-full"
                                maxLength={200}
                                value={settings.interests}
                                onChange={(e) => {
                                    setSetting("interests", e.target.value);
                                }}
                            />
                        </div>
                    </label>
                    <div className="text-right">
                        <Button onClick={() => props.onOpenChange(false)}>
                            Done
                        </Button>
                    </div>
                </div>
            </Dialog.Content>
        </Dialog>
    );
}
