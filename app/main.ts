import path from "path";
import * as fs from "fs/promises"
import { createInterface } from "readline";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
});

const builtinFunctions = new Set(['exit', 'echo', 'type']);
const PATH = "/usr/bin:/usr/local/bin:$PATH"

rl.prompt();

rl.on('line', async (input) => {
  const arrCommand = input.trim().split(/\s+/);
  const command = arrCommand[0];

  if (!builtinFunctions.has(command)) {
    console.log(`${command}: command not found`);
    rl.prompt();
    return;
  }

  if (command === 'exit') {
    rl.close();
    return;
  }

  if (command === 'echo') {
    console.log(arrCommand.slice(1).join(' '));
  }

  if (command === 'type') {
    if (arrCommand.length > 1) {
      const commandType = arrCommand[1];
  
      if (builtinFunctions.has(commandType)) {
        console.log(`${commandType} is a shell builtin`);
      } else {
        const commandPath = await findPath(commandType);
        commandPath ? console.log(`${commandType} is ${commandPath}`) : console.log(`${commandType}: not found`);
      }
    }
  }

  rl.prompt();
});

const findPath = async (command: string): Promise<string | undefined> => {
  const delimiter = path.delimiter;
  const paths = PATH.split(delimiter);

  for (const commandPath of paths) {
    const fullCommand = path.join(commandPath, command);

    if (await hasAccessPermission(fullCommand)) return fullCommand;
  }

  return undefined;
}

const hasAccessPermission = async (filePath: string): Promise<boolean> => {
  try {
    const stats = await fs.stat(filePath);
    if (!stats.isFile()) return false;
    await fs.access(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}