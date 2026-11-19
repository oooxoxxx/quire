export interface Versioned {
  id: string;
  revision: number;
  syncedRevision: number;
}

export interface RemotePointer {
  id: string;
  revision: number;
}

export type PlanAction = { type: "push" | "pull" | "conflict"; id: string };

export function planSync(local: Versioned[], remote: RemotePointer[]): PlanAction[] {
  const remoteMap = new Map(remote.map((item) => [item.id, item]));
  const localMap = new Map(local.map((item) => [item.id, item]));
  const ids = new Set<string>([...localMap.keys(), ...remoteMap.keys()]);
  const actions: PlanAction[] = [];
  for (const id of ids) {
    const left = localMap.get(id);
    const right = remoteMap.get(id);
    if (left && !right) {
      actions.push({ type: "push", id });
      continue;
    }
    if (!left && right) {
      actions.push({ type: "pull", id });
      continue;
    }
    if (!left || !right) continue;
    const localDirty = left.revision > left.syncedRevision;
    const remoteDirty = right.revision > left.syncedRevision;
    if (localDirty && remoteDirty) actions.push({ type: "conflict", id });
    else if (localDirty) actions.push({ type: "push", id });
    else if (remoteDirty) actions.push({ type: "pull", id });
  }
  return actions;
}

export function resolveKeepLocal<T extends Versioned & { updatedAt: string }>(
  local: T,
  remoteRevision: number,
  now = new Date().toISOString(),
): T {
  return { ...local, syncedRevision: remoteRevision, revision: remoteRevision + 1, updatedAt: now };
}

export function resolveKeepRemote<T extends Versioned>(remote: T): T {
  return { ...remote, syncedRevision: remote.revision };
}
