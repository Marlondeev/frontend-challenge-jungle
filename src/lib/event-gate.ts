export class VersionGate {
  private versions = new Map<string, number>();
  private seen = new Set<string>();
  accept(
    kind: string,
    event: { eventId: string; resourceId: string; version: number },
    currentVersion = 0,
  ): boolean {
    const key = `${kind}:${event.resourceId}`;
    if (
      !event.eventId ||
      !Number.isSafeInteger(event.version) ||
      event.version <= Math.max(currentVersion, this.versions.get(key) ?? 0) ||
      this.seen.has(event.eventId)
    )
      return false;
    this.versions.set(key, event.version);
    this.seen.add(event.eventId);
    if (this.seen.size > 500)
      this.seen.delete(this.seen.values().next().value!);
    return true;
  }
}
