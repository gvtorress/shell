import * as os from 'os';
import path from 'path';
import * as fs from 'fs/promises'
import { createInterface } from 'readline';
import ChildProcess from 'child_process';

type ParserState = 'normal' | 'single' | 'double';

interface parsedInput {
  command: string;
  args: string[];
  stdoutRedirect?: string;
}

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
});

const builtinFunctions = new Set(['exit', 'echo', 'type', 'pwd', 'cd']);
const paths = process.env.PATH?.split(path.delimiter) || '';
const home = os.homedir();

rl.prompt();

rl.on('line', async (input: string) => {
  const inputTrimmed = input.trim();
  if (inputTrimmed === '') {
    rl.prompt();
    return;
  }

  const { command, args, stdoutRedirect } = commandParser(inputTrimmed);

  if (!builtinFunctions.has(command)) {
    const commandPath = await findPath(command);
    if (!commandPath) {
      writeStdErr(`${command}: command not found`);
      rl.prompt();
      return;
    } else {
      rl.pause();
      if (process.stdin.isTTY) process.stdin.setRawMode(false);

      try {
        await runExternalCommand(commandPath, command, args, stdoutRedirect);
      } finally {
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
    await writeStdOut(args.join(' '), stdoutRedirect);
  }

  if (command === 'pwd') {
    await writeStdOut(process.cwd(), stdoutRedirect);
  }

  if (command === 'cd') {
    const newDir = resolveCdPath(args[0]);
    try {
      process.chdir(newDir);
    } catch {
      writeStdErr(`${command}: ${newDir}: No such file or directory`);
    }
  }

  if (command === 'type') {
    if (args.length >= 1) {
      const arrCommandType = args;

      for (const commandType of arrCommandType) {
        if (builtinFunctions.has(commandType)) {
          await writeStdOut(`${commandType} is a shell builtin`, stdoutRedirect);
        } else {
          const commandPath = await findPath(commandType);

          if (commandPath) {
            await writeStdOut(`${commandType} is ${commandPath}`, stdoutRedirect);
          } else {
            writeStdErr(`${commandType}: not found`);
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
  let redirection;
  let current = '';
  let state: ParserState = 'normal';
  let escape = false;
  let isRedirect = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (state === 'normal') {
      if (!escape) {
        if (char === '\\') {
          escape = true;
          continue;
        }

        if (char === '>') {
          isRedirect = true;
          continue;
        }
  
        if (char === ' ') {
          if (current.length > 0) {
            if (isRedirect) {
              redirection = current;
              isRedirect = false;
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
    if (isRedirect) {
      redirection = current;
      isRedirect = false;
    } else {
      args.push(current);
    }
  }

  const [command, ...arrArgs] = args;

  const parsedObject = {
    command,
    args: arrArgs,
    stdoutRedirect: redirection,
  }

  return parsedObject;
}

const writeStdOut = async (content: string, stdoutFile?: string) => {
  const contentWithLineBreak = `${content}\n`
  if (stdoutFile) {
    try {
      await fs.writeFile(stdoutFile, contentWithLineBreak);
    } catch (err) {
      if (err instanceof Error) writeStdErr(err.message);
    }
    return;
  }

  process.stdout.write(contentWithLineBreak);
}

const writeStdErr = (content: string) => {
  process.stderr.write(`${content}\n`);
}

const runExternalCommand = async (
  commandPath: string,
  command: string,
  args: string[],
  stdoutRedirect?: string,
): Promise<void> => {
  let outputFile: fs.FileHandle | undefined;

  try {
    const stdio: Array<'inherit' | number> = ['inherit', 'inherit', 'inherit'];

    if (stdoutRedirect) {
      outputFile = await fs.open(stdoutRedirect, 'w');
      stdio[1] = outputFile.fd;
    }

    const child = ChildProcess.spawn(commandPath, args, { argv0: command, stdio });

    await new Promise<void>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', () => resolve());
    });
  } finally {
    await outputFile?.close();
  }
}
