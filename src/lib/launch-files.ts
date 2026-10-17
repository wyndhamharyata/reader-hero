// The files the installed app was opened with, such as a PDF from Finder. A browser tab has no queue.
interface LaunchParams {
  readonly files: ReadonlyArray<FileSystemFileHandle>;
}

export function onLaunchFiles(receive: (files: ReadonlyArray<File>) => void): void {
  const queue = (
    window as {
      launchQueue?: { setConsumer(consumer: (launchParams: LaunchParams) => void): void };
    }
  ).launchQueue;
  if (queue === undefined) return;
  queue.setConsumer((launchParams) => {
    void Promise.all(launchParams.files.map((handle) => handle.getFile()))
      .then(receive)
      // A file the browser cannot hand over changes nothing, as a cancelled picker would.
      .catch(() => undefined);
  });
}
