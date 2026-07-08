/**
 * File Scanning helpers used by content/index.ts's file-picker/drag-and-drop
 * interception. Kept separate from the orchestration logic in
 * content/index.ts (same "adapters own DOM detail, index.ts owns
 * orchestration" split already used for prompt interception) - everything
 * here is a pure DOM/encoding utility with no knowledge of scanning,
 * decisions, or UI state.
 */

// Mirrors the backend's cap (schemas/scan.py MAX_FILE_BASE64_LENGTH ~10MB
// decoded, MAX_FILES_PER_SCAN 5) so an oversized/too-numerous selection is
// rejected instantly client-side with a clear reason instead of round-
// tripping to the backend just to get a 422.
export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024
export const MAX_FILES_PER_REQUEST = 5

/** Reads a File into a base64 string (no "data:...;base64," prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read file"))
    reader.onload = () => {
      const result = reader.result as string
      const commaIndex = result.indexOf(",")
      resolve(commaIndex >= 0 ? result.slice(commaIndex + 1) : result)
    }
    reader.readAsDataURL(file)
  })
}

/**
 * Re-injects a set of File objects into a native <input type="file">, as if
 * the user had just picked them, then fires the "change" event the page's
 * own composer is listening for. Used after a scan comes back ALLOW/WARN-
 * continue, so the site's own attach/upload flow proceeds normally with
 * exactly the files the employee selected. Works in Chromium (the only
 * engine this extension targets) because DataTransfer.items.add() accepts
 * real, user-obtained File objects - it does not fabricate file access, it
 * only re-associates files that already passed through a genuine user
 * gesture moments earlier.
 */
export function replayFilesIntoInput(input: HTMLInputElement, files: File[]): void {
  const dataTransfer = new DataTransfer()
  for (const file of files) dataTransfer.items.add(file)
  input.files = dataTransfer.files
  input.dispatchEvent(new Event("change", { bubbles: true }))
}

/**
 * Re-dispatches a synthetic "drop" DragEvent carrying the same File objects
 * as the original drop the extension intercepted, at the same viewport
 * coordinates, targeting whichever element is actually under that point
 * right now (the site's drop zone) rather than assuming the original
 * event.target is still correct.
 */
export function replayFilesAsDrop(files: File[], original: DragEvent): void {
  const dataTransfer = new DataTransfer()
  for (const file of files) dataTransfer.items.add(file)

  const target =
    document.elementFromPoint(original.clientX, original.clientY) ?? (original.target as EventTarget) ?? document.body

  const dropEvent = new DragEvent("drop", {
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: original.clientX,
    clientY: original.clientY,
  })
  // DragEvent's constructor options don't reliably accept `dataTransfer` in
  // every TS lib target, so it's assigned directly - this mirrors how the
  // native event carries it and is the standard workaround for
  // constructing a synthetic drop with a specific payload.
  Object.defineProperty(dropEvent, "dataTransfer", { value: dataTransfer })

  target.dispatchEvent(dropEvent)
}

export interface OversizedFile {
  file: File
  reason: string
}

/** Client-side size/count guard - purely a fast UX check, never a security
 * boundary (the backend enforces the real limits regardless). */
export function partitionBySize(files: File[]): { ok: File[]; rejected: OversizedFile[] } {
  const ok: File[] = []
  const rejected: OversizedFile[] = []
  for (const file of files) {
    if (file.size > MAX_FILE_SIZE_BYTES) {
      rejected.push({ file, reason: `"${file.name}" is larger than the ${MAX_FILE_SIZE_BYTES / (1024 * 1024)}MB scan limit.` })
    } else {
      ok.push(file)
    }
  }
  return { ok, rejected }
}
