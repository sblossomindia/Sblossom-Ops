/**
 * Interactive prompt helpers using Node built-ins.
 *
 * Why event-based readline with a queue (not `rl.question()` promises):
 *   When stdin is piped, readline emits 'line' events as the input chunk
 *   arrives. If those events fire while the script is awaiting between
 *   prompts, `rl.question()` installs its listener too late and the line
 *   is lost. The queue catches every line; readLine() drains it.
 *
 * Password input transiently swaps `_writeToOutput` to suppress echo on
 * a TTY. On piped input readline doesn't echo anyway.
 */
import * as readline from 'node:readline';

type RL = readline.Interface & {
  _writeToOutput?: (s: string) => void;
};

let _rl: RL | null = null;
const queue: string[] = [];
let waiterResolve: ((line: string) => void) | null = null;
let waiterReject: ((err: Error) => void) | null = null;
let inputClosed = false;

function getRl(): RL {
  if (_rl) return _rl;
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: Boolean(process.stdin.isTTY),
  }) as RL;
  rl.on('line', (line) => {
    if (waiterResolve) {
      const r = waiterResolve;
      waiterResolve = null;
      waiterReject = null;
      r(line);
    } else {
      queue.push(line);
    }
  });
  rl.on('close', () => {
    inputClosed = true;
    if (waiterReject) {
      const rej = waiterReject;
      waiterResolve = null;
      waiterReject = null;
      rej(new Error('Unexpected end of input'));
    }
  });
  _rl = rl;
  return rl;
}

function readLine(): Promise<string> {
  getRl();
  return new Promise((resolve, reject) => {
    if (queue.length > 0) {
      resolve(queue.shift()!);
      return;
    }
    if (inputClosed) {
      reject(new Error('Unexpected end of input'));
      return;
    }
    waiterResolve = resolve;
    waiterReject = reject;
  });
}

export async function ask(prompt: string): Promise<string> {
  process.stdout.write(prompt);
  return (await readLine()).trim();
}

export async function askPassword(prompt: string): Promise<string> {
  const rl = getRl();
  process.stdout.write(prompt);

  const original = rl._writeToOutput;
  rl._writeToOutput = (s: string) => {
    if (s.includes('\n') || s.includes('\r')) process.stdout.write('\n');
  };

  try {
    return await readLine();
  } finally {
    rl._writeToOutput = original;
  }
}

export async function confirm(prompt: string, defaultYes = false): Promise<boolean> {
  const suffix = defaultYes ? ' [Y/n]: ' : ' [y/N]: ';
  const answer = (await ask(prompt + suffix)).toLowerCase();
  if (answer === '') return defaultYes;
  return answer === 'y' || answer === 'yes';
}

/** Re-prompt until `parse` succeeds. */
export async function askValid<T>(prompt: string, parse: (raw: string) => T): Promise<T> {
  while (true) {
    const raw = await ask(prompt);
    try {
      return parse(raw);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ ${msg}`);
    }
  }
}

export function closePrompts(): void {
  if (_rl) _rl.close();
}
