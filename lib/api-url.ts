// Creation deliberately avoids Hosting's extra proxy hop. Keep edit APIs relative.
export function apiBase(
  path: string,
  c: { projectId: string; emulator?: boolean; apiBase?: string },
) {
  return path === "/races" && !c.emulator
    ? `https://us-central1-${c.projectId}.cloudfunctions.net/api`
    : (c.apiBase ?? "/api");
}
