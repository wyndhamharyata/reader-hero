// The files the installed app was opened with, such as a PDF from Finder; a browser tab has no queue.
interface LaunchParams {
  readonly files: ReadonlyArray<FileSystemFileHandle>;
}

export function onLaunchFiles(receive: (files: ReadonlyArray<File>) => void): void {
  const queue = (
    window as {
      launchQueue?: { setConsumer(consumer: (params: LaunchParams) => void): void };
    }
  ).launchQueue;
  if (queue === undefined) return;
  queue.setConsumer((params) => {
    void Promise.all(params.files.map((handle) => handle.getFile()))
      .then(receive)
      // A file the browser cannot hand over adds nothing, as a cancelled picker would.
      .catch(() => undefined);
  });
}
