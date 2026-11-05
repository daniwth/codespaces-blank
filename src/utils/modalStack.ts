/**
 * Stack of open modal layers. Every modal listens for Escape on window, so
 * without this a single key press would close the BIOS *and* the rack modal
 * underneath it. Only the top-most layer reacts.
 */
const stack: number[] = [];
let nextId = 0;

export function pushLayer(): number {
  nextId += 1;
  stack.push(nextId);
  return nextId;
}

export function popLayer(id: number): void {
  const i = stack.lastIndexOf(id);
  if (i >= 0) stack.splice(i, 1);
}

export const isTopLayer = (id: number): boolean => stack[stack.length - 1] === id;
