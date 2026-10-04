export const IMAGE_REFERENCE_LIMIT = 10 * 1024 * 1024;
export const IMAGE_PROMPT_LIMIT = 8000;

/** Offline formatting only: preserve the idea rather than inventing subject details. */
export function improveImagePrompt(idea: string, style: string, aspect: string, reference: boolean): string {
  if (!idea.trim()) throw new Error("Write an image idea first.");
  const text = [
    `Create an image based on this brief:\n${idea.trim()}`,
    style === "Keep my style" ? "Follow the visual style described in the brief." : `Visual style: ${style}.`,
    `Composition: ${aspect === "Auto" ? "choose framing that suits the subject" : `${aspect} aspect ratio`}; keep the main subject clear and preserve intentional negative space.`,
    "Use coherent lighting, perspective and materials. Preserve all specific details in the brief. Do not add text, logos or extra subjects unless requested.",
    reference ? "Use the reference image I attach in Gemini. Preserve its defining details unless the brief explicitly asks to change them." : "",
  ].filter(Boolean).join("\n\n");
  if (text.length > IMAGE_PROMPT_LIMIT) throw new Error("Shorten your idea to leave room for the prompt structure.");
  return text;
}

export async function validateImageReference(file: File): Promise<void> {
  if (!file.size || file.size > IMAGE_REFERENCE_LIMIT) throw new Error("Choose an image up to 10 MB.");
  const bytes = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  const png = bytes.length >= 8 && [137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b);
  const jpeg = bytes[0]===255 && bytes[1]===216 && bytes[2]===255;
  const webp = bytes.length >= 12 && String.fromCharCode(...bytes.slice(0,4))==="RIFF" && String.fromCharCode(...bytes.slice(8,12))==="WEBP";
  if (!((file.type === "image/png" && png) || (file.type === "image/jpeg" && jpeg) || (file.type === "image/webp" && webp))) {
    throw new Error("Choose a PNG, JPEG or WebP image.");
  }
}

/** One local thumbnail at a time; never uploads or copies file contents. */
export class ImageReferencePreview {
  url = "";
  private revision = 0;
  private readonly urls: Pick<typeof URL, "createObjectURL" | "revokeObjectURL">;
  constructor(urls: Pick<typeof URL, "createObjectURL" | "revokeObjectURL"> = URL) { this.urls = urls; }
  async set(file: File): Promise<boolean> {
    const revision = ++this.revision;
    await validateImageReference(file);
    if (revision !== this.revision) return false;
    const next = this.urls.createObjectURL(file);
    if (this.url) this.urls.revokeObjectURL(this.url);
    this.url = next;
    return true;
  }
  clear() {
    this.revision++;
    if (this.url) this.urls.revokeObjectURL(this.url);
    this.url = "";
  }
}
