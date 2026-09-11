import type { Fix } from "../shared/race";
export function parseReplayKml(
  text: string,
  signal: AbortSignal,
): Promise<Fix[]> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("Upload cancelled."));
      return;
    }
    const worker = new Worker(new URL("./kml-worker.ts", import.meta.url), {
      type: "module",
    });
    const cleanup = () => {
      worker.terminate();
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(new Error("Upload cancelled."));
    };
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = ({
      data,
    }: MessageEvent<{ points?: Fix[]; error?: string }>) => {
      cleanup();
      if (data.error) reject(new Error(data.error));
      else resolve(data.points!);
    };
    worker.onerror = () => {
      cleanup();
      reject(new Error("Could not read KML. Try uploading the file again."));
    };
    worker.postMessage(text);
  });
}
