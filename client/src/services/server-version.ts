export type ServerVersionObservation = "stale" | "current" | "advanced";

type ServerVersionListener = (version: number) => void;

let latestKnownServerVersion = 0;
let notificationScheduled = false;

const listeners = new Set<ServerVersionListener>();

export function isValidServerVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

export function getLatestKnownServerVersion(): number {
  return latestKnownServerVersion;
}

export function observeServerVersion(
  version: number,
): ServerVersionObservation {
  if (!isValidServerVersion(version)) {
    throw new Error("Invalid server version");
  }

  if (version < latestKnownServerVersion) {
    return "stale";
  }

  if (version === latestKnownServerVersion) {
    return "current";
  }

  latestKnownServerVersion = version;
  scheduleNotification();

  return "advanced";
}

export function subscribeToServerVersion(
  listener: ServerVersionListener,
): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function scheduleNotification(): void {
  if (notificationScheduled) {
    return;
  }

  notificationScheduled = true;

  window.setTimeout(() => {
    notificationScheduled = false;
    const version = latestKnownServerVersion;

    for (const listener of [...listeners]) {
      listener(version);
    }
  }, 0);
}
