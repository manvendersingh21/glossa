export function parseJsonForScript<T>(body: string): T {
  return JSON.parse(body) as T;
}
