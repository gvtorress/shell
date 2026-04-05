import * as os from 'os';
import path from 'path';
import * as fs from 'fs/promises'
import { createInterface } from 'readline';
import ChildProcess from 'child_process';

type ParserState = 'normal' | 'single' | 'double';

interface parsedInput {
  command: string;
  args: string[];
  isAppend: boolean;
  stdoutRedirect?: string;
  stderrRedirect?: string;
}

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
});

const builtinFunctions = new Set(['exit', 'echo', 'type', 'pwd', 'cd']);
const paths = process.env.PATH?.split(path.delimiter) || '';
const home = os.homedir();
let terminalEndsWithNewline = true;

rl.prompt();

rl.on('line', async (input: string) => {
  const inputTrimmed = input.trim();
  if (inputTrimmed === '') {
    rl.prompt();
    return;
  }

  const {
    command, args, stdoutRedirect, stderrRedirect, isAppend,
  } = commandParser(inputTrimmed);

  if (!builtinFunctions.has(command)) {
    const commandPath = await findPath(command);
    if (!commandPath) {
      writeStdErr(`${command}: command not found\n`, isAppend, stderrRedirect);
      rl.prompt();
      return;
    } else {
      rl.pause();
      if (process.stdin.isTTY) process.stdin.setRawMode(false);

      try {
        await runExternalCommand(commandPath, command, args, isAppend, stdoutRedirect, stderrRedirect);
      } finally {
        if (!terminalEndsWithNewline) {
          process.stdout.write('\n');
          terminalEndsWithNewline = true;
        }

        if (process.stdin.isTTY) process.stdin.setRawMode(true);
        rl.resume();
        rl.prompt();
      }
      return;
    }
  }

  if (command === 'exit') {
    rl.close();
    return;
  }

  if (command === 'echo') {
    await writeStdOut(`${args.join(' ')}\n`, isAppend, stdoutRedirect, stderrRedirect);
    if (stderrRedirect) await writeStdErr('', isAppend, stderrRedirect);
  }

  if (command === 'pwd') {
    await writeStdOut(`${process.cwd()}\n`, isAppend, stdoutRedirect, stderrRedirect);
    if (stderrRedirect) await writeStdErr('', isAppend, stderrRedirect);
  }

  if (command === 'cd') {
    const newDir = resolveCdPath(args[0]);
    try {
      process.chdir(newDir);
    } catch {
      writeStdErr(`${command}: ${newDir}: No such file or directory\n`, isAppend, stderrRedirect);
    }
  }

  if (command === 'type') {
    if (args.length >= 1) {
      const arrCommandType = args;

      for (const commandType of arrCommandType) {
        if (builtinFunctions.has(commandType)) {
          await writeStdOut(`${commandType} is a shell builtin\n`, isAppend, stdoutRedirect, stderrRedirect);
        } else {
          const commandPath = await findPath(commandType);

          if (commandPath) {
            await writeStdOut(`${commandType} is ${commandPath}\n`, isAppend, stdoutRedirect, stderrRedirect);
          } else {
            writeStdErr(`${commandType}: not found\n`, isAppend, stderrRedirect);
          }
        }
      }
    }
  }

  rl.prompt();
});

const findPath = async (command: string): Promise<string | undefined> => {
  for (const commandPath of paths) {
    const fullCommand = path.join(commandPath, command);

    if (await isValidExecutable(fullCommand)) return fullCommand;
  }

  return undefined;
}

const isValidExecutable = async (filePath: string): Promise<boolean> => {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return false;
    await fs.access(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

const resolveCdPath = (input?: string): string => {
  if (!input || input === '~') return home;

  if (input.startsWith('~/')) return path.join(home, input.slice(2));

  return input;
}

const commandParser = (input: string): parsedInput => {
  const args: string[] = [];
  let stdoutRedirect;
  let stderrRedirect;
  let current = '';
  let state: ParserState = 'normal';
  let escape = false;
  let isStdoutRedirect = false;
  let isStderrRedirect = false;
  let isAppend = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (state === 'normal') {
      if (!escape) {
        if (char === '\\') {
          escape = true;
          continue;
        }

        if (char === '>') {
          isAppend = input[i - 1] === '>';
          isStdoutRedirect = !isStderrRedirect && (current === '1' || current === '');
          isStderrRedirect = isStderrRedirect || current === '2';

          if (current.length >= 2) args.push(current);

          current = '';

          continue;
        }
  
        if (char === ' ') {
          if (current.length > 0) {
            if (isStdoutRedirect) {
              stdoutRedirect = current;
              isStdoutRedirect = false;
            } else if (isStderrRedirect) {
              stderrRedirect = current;
              isStderrRedirect = false;
            } else {
              args.push(current);
            }
            current = '';
          }
          continue;
        }
  
        if (char === "'") {
          state = 'single';
          continue;
        }
  
        if (char === '"') {
          state = 'double';
          continue;
        }
      }
    }

    if (state === 'single') {
      if (char === "'") {
        state = 'normal';
        continue;
      }
    }

    if (state === 'double') {
      if (!escape) {
        if (char === '\\') {
          escape = true;
          continue;
        }
  
        if (char === '"') {
          state = 'normal';
          continue;
        }
      }
    }

    if (escape) escape = false;
  
    current += char;
  }

  if (current.length > 0) {
    if (isStdoutRedirect) {
      stdoutRedirect = current;
      isStdoutRedirect = false;
    } else if (isStderrRedirect) {
      stderrRedirect = current;
      isStderrRedirect = false;
    } else {
      args.push(current);
    }
  }

  const [command, ...arrArgs] = args;

  const parsedObject = {
    command,
    args: arrArgs,
    stdoutRedirect,
    stderrRedirect,
    isAppend,
  }

  return parsedObject;
}

const writeStdOut = async (content: string, isAppend: boolean, stdoutFile?: string, stderrFile?: string) => {
  if (stdoutFile) {
    try {
      if (isAppend) {
        await fs.appendFile(stdoutFile, content);
      } else {
        await fs.writeFile(stdoutFile, content);
      }
    } catch (err) {
      if (err instanceof Error) await writeStdErr(`${err.message}\n`, isAppend, stderrFile);
    }
    return;
  }

  process.stdout.write(content);
}

const writeStdErr = async (content: string, isAppend: boolean, stderrFile?: string) => {
  if (stderrFile) {
    try {
      if (isAppend) {
        await fs.appendFile(stderrFile, content);
      } else {
        await fs.writeFile(stderrFile, content);
      }
    } catch (err) {
      if (err instanceof Error) process.stderr.write(err.message);
    }
    return;
  }

  process.stderr.write(content);
}

const runExternalCommand = async (
  commandPath: string,
  command: string,
  args: string[],
  isAppend: boolean,
  stdoutRedirect?: string,
  stderrRedirect?: string,
): Promise<void> => {
  let outputFile: fs.FileHandle | undefined;
  let errOutputFile: fs.FileHandle | undefined;

  try {
    const child = ChildProcess.spawn(commandPath, args, {
      argv0: command,
      stdio: ['inherit', 'pipe', 'pipe'],
    });

    if (child.stdout) {
      if (stdoutRedirect) {
        outputFile = await fs.open(stdoutRedirect, isAppend ? 'a' : 'w');

        child.stdout.on('data', (chunk) => {
          if (isAppend) {
            outputFile?.appendFile(chunk);
          } else {
            outputFile?.write(chunk);
          }
        });

      } else {
        child.stdout.on('data', (chunk) => {
          process.stdout.write(chunk);
          updateTerminalLineState(chunk);
        });
      }
    }

    if (child.stderr) {
      if (stderrRedirect) {
        errOutputFile = await fs.open(stderrRedirect, isAppend ? 'a' : 'w');

        child.stderr.on('data', (chunk) => {
          if (isAppend) {
            errOutputFile?.appendFile(chunk);
          } else {
            errOutputFile?.write(chunk);
          }
        });

      } else {
        child.stderr.on('data', (chunk) => {
          process.stderr.write(chunk);
          updateTerminalLineState(chunk);
        });
      }
    }

    await new Promise<void>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', () => resolve());
    });
  } finally {
    await outputFile?.close();
    await errOutputFile?.close();
  }
}

const updateTerminalLineState = (chunk: Buffer | string) => {
  const text = chunk.toString();
  terminalEndsWithNewline = text.endsWith('\n');
}
