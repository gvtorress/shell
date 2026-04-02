import * as os from 'os';
import path from 'path';
import * as fs from 'fs/promises'
import { createInterface } from 'readline';
import ChildProcess from 'child_process';

type ParserState = 'normal' | 'single' | 'double' | 'escape';

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
});

const builtinFunctions = new Set(['exit', 'echo', 'type', 'pwd', 'cd']);
const paths = process.env.PATH?.split(path.delimiter) || '';
const home = os.homedir();

rl.prompt();

rl.on('line', async (input) => {
  const inputTrimmed = input.trim();
  if (inputTrimmed === '') {
    rl.prompt();
    return;
  }

  const arrCommand = commandParser(inputTrimmed);
  const [command, ...args] = arrCommand;

  if (!builtinFunctions.has(command)) {
    const commandPath = await findPath(command);
    if (!commandPath) {
      console.log(`${command}: command not found`);
      rl.prompt();
      return;
    } else {
      rl.pause();
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      const child = ChildProcess.spawn(commandPath, args, { argv0: command, stdio: 'inherit' });

      child.on('close', () => {
        process.stdin.setRawMode(true);
        rl.prompt();
      });
      return;
    }
  }

  if (command === 'exit') {
    rl.close();
    return;
  }

  if (command === 'echo') {
    console.log(args.join(' '));
  }

  if (command === 'pwd') {
    console.log(process.cwd());
  }

  if (command === 'cd') {
    const newDir = resolveCdPath(args[0]);
    try {
      process.chdir(newDir);
    } catch {
      console.log(`${command}: ${newDir}: No such file or directory`);
    }
  }

  if (command === 'type') {
    if (arrCommand.length > 1) {
      const arrCommandType = args;
      
      for (const commandType of arrCommandType) {
        if (builtinFunctions.has(commandType)) {
          console.log(`${commandType} is a shell builtin`);
        } else {
          const commandPath = await findPath(commandType);
          commandPath ? console.log(`${commandType} is ${commandPath}`) : console.log(`${commandType}: not found`);
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

const commandParser = (input: string): string[] => {
  const args: string[] = [];
  let current = '';
  let state: ParserState = 'normal';
  for (let i = 0; i < input.length; i++) {
    const char = input[i];

    if (state === 'normal') {
      if (char === '\\') {
        state = 'escape';
        continue;
      }

      if (char === ' ') {
        if (current.length > 0) {
          args.push(current);
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

    if (
      (state === 'single' && char === "'")
        || (state === 'double' && char === '"')
    ) {
      state = 'normal';
      continue;
    }

    if (state === 'escape') state = 'normal';
  
    current += char;
  }

  if (current.length > 0) args.push(current);

  return args;
}
