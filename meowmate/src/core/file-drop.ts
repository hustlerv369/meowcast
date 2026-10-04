export interface PreparedAttachment { name: string; path: string }

/** Only a completed, current copy may replace the user's pending attachment. */
export class FileDropTransaction {
  busy = false;
  pendingName = "";
  private generation = 0;

  async run(
    paths: string[],
    copy: (path: string) => Promise<PreparedAttachment>,
    commit: (file: PreparedAttachment) => void,
  ): Promise<boolean> {
    if (this.busy) throw new Error("The file is still being prepared. Wait until it is ready.");
    if (paths.length !== 1 || !paths[0]) {
      throw new Error("Drop one file. Multiple attachments are not supported yet.");
    }
    const ticket = ++this.generation;
    this.busy = true;
    this.pendingName = paths[0].split(/[\\/]/).pop() || "file";
    try {
      const prepared = await copy(paths[0]);
      if (ticket !== this.generation) return false;
      commit(prepared);
      return true;
    } finally {
      this.busy = false;
      this.pendingName = "";
    }
  }

  /** Invalidates an obsolete result without allowing a second concurrent copy. */
  invalidate() { this.generation++; }
}

export const fileDrop = new FileDropTransaction();
