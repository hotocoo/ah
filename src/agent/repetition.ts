// Detects degenerate generation loops in a token stream: the same chunk of text
// repeated back-to-back many times (observed on local models under sampling, where a
// single turn can otherwise run to the output cap for many minutes).

export interface RepetitionGuardOptions {
  window: number; // characters of recent output to inspect
  unit: number; // length of the probe taken from the end of the stream
  repeats: number; // occurrences of the probe inside the window that count as a loop
  checkEvery: number; // characters between checks
}

export const DEFAULT_REPETITION: RepetitionGuardOptions = { window: 6000, unit: 120, repeats: 8, checkEvery: 1000 };

export class RepetitionGuard {
  private buf = "";
  private sinceCheck = 0;

  constructor(private o: RepetitionGuardOptions = DEFAULT_REPETITION) {}

  // Feeds streamed text; returns true once the recent output is a loop.
  push(text: string): boolean {
    this.buf = (this.buf + text).slice(-this.o.window);
    this.sinceCheck += text.length;
    if (this.sinceCheck < this.o.checkEvery || this.buf.length < this.o.unit * this.o.repeats) return false;
    this.sinceCheck = 0;
    return isLooping(this.buf, this.o.unit, this.o.repeats);
  }
}

export function isLooping(text: string, unit: number, repeats: number): boolean {
  const probe = text.slice(-unit);
  if (probe.trim().length < unit / 4) return false; // whitespace runs are not loops
  let count = 0;
  let from = 0;
  for (;;) {
    const i = text.indexOf(probe, from);
    if (i < 0) break;
    count++;
    from = i + probe.length;
  }
  return count >= repeats;
}
