import type { AssetPathResolver } from "@Core/AssetPathResolver";
import type { Extension } from "@Core/Extension";
import type { Translator } from "@Core/Translator";
import { createCopyToClipboardAction, type InstantSearchResultItems, type SearchResultItem } from "@common/Core";
import type { Image } from "@common/Core/Image";
import emojiKeywords from "emojilib";

const TRIGGER_PREFIX = ":";
const MAX_RESULTS = 20;

type EmojiEntry = {
    emoji: string;
    name: string;
    keywords: string[];
};

export class EmojiPickerExtension implements Extension {
    public readonly id = "EmojiPicker";
    public readonly name = "Emoji Picker";

    public readonly nameTranslation = {
        key: "extensionName",
        namespace: "extension[EmojiPicker]",
    };

    public readonly author = {
        name: "Hustler",
        githubUserName: "hustlerv369",
    };

    private readonly entries: EmojiEntry[];

    public constructor(
        private readonly assetPathResolver: AssetPathResolver,
        private readonly translator: Translator,
    ) {
        this.entries = Object.entries(emojiKeywords as Record<string, string[]>).map(([emoji, keywords]) => ({
            emoji,
            name: (keywords[0] ?? "emoji").replace(/_/g, " "),
            // Normalize underscores to spaces so multi-word searches (e.g. ":grinning face",
            // which is how the name is displayed) match the emojilib keywords ("grinning_face").
            keywords: keywords.map((keyword) => keyword.toLowerCase().replace(/_/g, " ")),
        }));
    }

    public async getSearchResultItems(): Promise<SearchResultItem[]> {
        return [];
    }

    public getInstantSearchResultItems(searchTerm: string): InstantSearchResultItems {
        const { t } = this.translator.createT(this.getI18nResources());

        const trimmed = searchTerm.trim();

        if (!trimmed.startsWith(TRIGGER_PREFIX)) {
            return { before: [], after: [] };
        }

        const query = trimmed.slice(TRIGGER_PREFIX.length).trim().toLowerCase().replace(/_/g, " ");

        if (!query) {
            return { before: [], after: [] };
        }

        const scored = this.entries
            .map((entry) => ({ entry, score: EmojiPickerExtension.scoreEntry(entry, query) }))
            .filter(({ score }) => score > 0)
            .sort((a, b) => b.score - a.score)
            .slice(0, MAX_RESULTS);

        return {
            before: scored.map(({ entry }) => ({
                id: `EmojiPicker:${entry.emoji}`,
                name: `${entry.emoji}  ${entry.name}`,
                description: t("searchResultItemDescription"),
                image: EmojiPickerExtension.getEmojiImage(entry.emoji),
                defaultAction: {
                    ...createCopyToClipboardAction({
                        textToCopy: entry.emoji,
                        description: t("copyEmoji"),
                        descriptionTranslation: {
                            key: "copyEmoji",
                            namespace: "extension[EmojiPicker]",
                        },
                    }),
                    hideWindowAfterInvocation: true,
                },
            })),
            after: [],
        };
    }

    public isSupported(): boolean {
        return true;
    }

    public getSettingDefaultValue(): undefined {
        return undefined;
    }

    public getImage(): Image {
        return {
            url: `file://${this.assetPathResolver.getExtensionAssetPath(this.id, "icon.svg")}`,
        };
    }

    public getSettingKeysTriggeringRescan() {
        return ["general.language"];
    }

    public getI18nResources() {
        return {
            "en-US": {
                extensionName: "Emoji Picker",
                searchResultItemDescription: "Emoji — Enter to copy",
                copyEmoji: "Copy emoji to clipboard",
            },
            "cs-CZ": {
                extensionName: "Výběr emoji",
                searchResultItemDescription: "Emoji — Enterem zkopíruješ",
                copyEmoji: "Zkopírovat emoji do schránky",
            },
        };
    }

    private static scoreEntry(entry: EmojiEntry, query: string): number {
        let score = 0;

        for (const keyword of entry.keywords) {
            if (keyword === query) {
                score = Math.max(score, 100);
            } else if (keyword.startsWith(query)) {
                score = Math.max(score, 60);
            } else if (keyword.includes(query)) {
                score = Math.max(score, 30);
            }
        }

        return score;
    }

    private static getEmojiImage(emoji: string): Image {
        // Render the emoji itself as the item icon via an inline SVG
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><text x="16" y="24" font-size="24" text-anchor="middle">${emoji}</text></svg>`;
        return { url: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}` };
    }
}
