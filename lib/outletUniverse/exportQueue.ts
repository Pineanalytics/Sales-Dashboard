/** One big outlet extract is built at a time, across every extract route: a year (or six months) holds about 60,000 outlets and the Excel build alone needs about half a gigabyte, so two at once would be a lot to ask of the app. */
let queue: Promise<unknown> = Promise.resolve();

export function oneAtATime<T>(work: () => Promise<T>): Promise<T> {
  const run = queue.then(work, work);
  queue = run.catch(() => undefined);
  return run;
}
