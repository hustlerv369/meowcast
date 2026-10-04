import type { SearchResultItem } from "@common/Core";

export const usageSettingKey = "search.itemUsage";
export const maxUsageEntries = 500;
export type ItemUsage = Record<string, number>;

export const readItemUsage = (value: unknown): ItemUsage => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value)
            .filter(([, count]) => typeof count === "number" && Number.isSafeInteger(count) && count > 0)
            .sort((a, b) => (b[1] as number) - (a[1] as number))
            .slice(0, maxUsageEntries),
    );
};

export const incrementItemUsage = (value: unknown, id: string): ItemUsage => {
    const usage = readItemUsage(value);
    const count = Object.hasOwn(usage, id) ? usage[id] : 0;

    if (!Object.hasOwn(usage, id) && Object.keys(usage).length >= maxUsageEntries) {
        delete usage[Object.keys(usage).at(-1)!];
    }

    return readItemUsage({ ...usage, [id]: Math.min(count + 1, Number.MAX_SAFE_INTEGER) });
};

export const rankByUsage = (items: SearchResultItem[], value: unknown): SearchResultItem[] => {
    const usage = readItemUsage(value);
    const count = (id: string) => (Object.hasOwn(usage, id) ? usage[id] : 0);
    return [...items].sort((a, b) => count(b.id) - count(a.id) || a.name.localeCompare(b.name));
};
