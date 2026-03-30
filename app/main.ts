import * as os from 'os';
import path from "path";
import * as fs from "fs/promises"
import { createInterface } from "readline";
import ChildProcess from "child_process";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
});

const builtinFunctions = new Set(['exit', 'echo', 'type', 'pwd', 'cd']);
const paths = process.env.PATH?.split(path.delimiter) || '';
const home = os.homedir();
const inputRegex = /(?:'[^']*'|[^\s'])+/g;

rl.prompt();

rl.on('line', async (input) => {
  if (input.trim() === '') {
    rl.prompt();
    return;
  }

  const arrCommand = input.match(inputRegex)?.map(arg => arg.replace(/'/g, "")) ?? [];
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
