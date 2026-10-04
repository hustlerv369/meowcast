import type { BrowserWindow, Rectangle } from "electron";

const dimension = (value: number) => (Number.isFinite(value) ? Math.max(1, Math.min(32767, Math.floor(value))) : 1);

/** Integer DIP scanlines clip the native acrylic surface as well as renderer content. */
export const roundedWindowRegion = (rawWidth: number, rawHeight: number, rawRadius = 20): Rectangle[] => {
    const width = dimension(rawWidth);
    const height = dimension(rawHeight);
    const radius = Number.isFinite(rawRadius)
        ? Math.max(0, Math.min(256, Math.floor(rawRadius), Math.floor((width - 1) / 2), Math.floor((height - 1) / 2)))
        : 0;

    if (radius === 0) {
        return [{ x: 0, y: 0, width, height }];
    }

    const rectangles: Rectangle[] = [];

    if (height > radius * 2) {
        rectangles.push({ x: 0, y: radius, width, height: height - radius * 2 });
    }

    for (let y = 0; y < radius; y++) {
        const offset = radius - y - 0.5;
        const inset = Math.ceil(radius - Math.sqrt(radius * radius - offset * offset));
        rectangles.push({ x: inset, y, width: width - inset * 2, height: 1 });
        rectangles.push({ x: inset, y: height - y - 1, width: width - inset * 2, height: 1 });
    }

    return rectangles;
};

export const applyRoundedWindowRegion = (
    window: Pick<BrowserWindow, "getSize" | "setShape" | "isDestroyed" | "on">,
    onFailure: () => void = () => console.warn("Native rounded window clipping is unavailable."),
) => {
    let failed = false;
    const update = () => {
        if (!failed && !window.isDestroyed()) {
            try {
                const [width, height] = window.getSize();
                window.setShape(roundedWindowRegion(width, height));
            } catch {
                failed = true;
                onFailure();
            }
        }
    };
    window.on("resize", update);
    update();
};
