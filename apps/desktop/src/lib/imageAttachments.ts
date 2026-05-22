import { makeId } from "./browserRuntime";

export type OpencodeImageAttachment = {
  id: string;
  filename: string;
  mime: string;
  dataUrl: string;
};

export function readImageFileAsAttachment(file: File): Promise<OpencodeImageAttachment | null> {
  if (!file.type.startsWith("image/")) return Promise.resolve(null);
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.addEventListener("error", () => resolve(null));
    reader.addEventListener("load", () => {
      const raw = typeof reader.result === "string" ? reader.result : "";
      const comma = raw.indexOf(",");
      if (!raw || comma < 0) {
        resolve(null);
        return;
      }
      resolve({
        id: `img-${makeId()}`,
        filename: file.name || `image-${Date.now()}.png`,
        mime: file.type || "image/png",
        dataUrl: `data:${file.type || "image/png"};base64,${raw.slice(comma + 1)}`
      });
    });
    reader.readAsDataURL(file);
  });
}
