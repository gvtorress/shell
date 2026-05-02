import * as os from 'os';
import path from 'path';
import * as fs from 'fs/promises'
import ChildProcess from 'child_process';

type ParserState = 'normal' | 'single' | 'double';

interface ShellLineEditorInterface {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  promptLabel: string;
  onSubmit: (input: string) => Promise<void>;
}

interface parsedInput {
  command: string;
  args: string[];
  isAppend: boolean;
  stdoutRedirect?: string;
  stderrRedirect?: string;
}

class ShellLineEditor implements ShellLineEditorInterface {
  input: NodeJS.ReadableStream;
  output: NodeJS.WritableStream;
  promptLabel: string;
  onSubmit: (input: string) => Promise<void>;
  _buffer: string = '';
  _cursor: number = 0;

  constructor({
    input, output, promptLabel, onSubmit,
  }: ShellLineEditorInterface) {
    this.input = input;
    this.output = output;
    this.promptLabel = promptLabel;
    this.onSubmit = onSubmit;
  };

  start = () => {
    this.input.on('data', this.handleKey);
  }

  prompt = () => {
    this._buffer = '';
    this._cursor = -1;
    this.output.write(this.promptLabel);
  };

  handleKey = async (chunk: string) => {
    for (const key of chunk) {
      await this.handleSingleKey(key);
    }
  };

  handleSingleKey = async (key: string) => {
    // ctrl + c
    if (key === '\u0003') {
      this.close();
      return;
    }

    // backspace  
    if (key === '\u007f') {
      this.handleBackspace();
      return;
    }

    // enter
    if (key === '\r' || key === '\n') {
      const line = this._buffer;
      this.output.write('\n');
      this._buffer = '';
      this._cursor = -1;
      await this.onSubmit(line);
      return;
    }

    // tab
    if (key === '\t') {
      this.handleAutocomplete();
      return;
    }

    this.insertText(key);
  };

  close = () => {
    this.input.pause();
    if (process.stdin.isTTY) process.stdin.setRawMode(false);
    process.exit(0);
  }

  handleBackspace = () => {
    if (this._cursor === -1) {
      this._buffer = '';
      return;
    }

    this._buffer = this._buffer.slice(0, this._cursor);
    this._cursor -= 1;

    if (process.stdout.isTTY) {
      process.stdout.clearLine(0);
      process.stdout.cursorTo(0);
      process.stdout.write(this.promptLabel + this._buffer);
    };
  };

  handleAutocomplete = () => {
    const prefix = this._buffer;
    if (prefix.length >= 2) {
      let word = '';
      let completion = '';
      if ('exit'.includes(prefix)) {
        word = 'exit';
        completion = word.slice(prefix.length) + ' ';
        this._buffer += completion;
        this._cursor += completion.length;
        this.output.write(completion);
        return;
      };

      if ('echo'.includes(prefix)) {
        word = 'echo';
        completion = word.slice(prefix.length) + ' ';
        this._buffer += completion;
        this._cursor += completion.length
        this.output.write(completion);
        return;
      };
    }
  }

  insertText = (key: string) => {
    this._buffer += key;
    this._cursor += 1;
    this.output.write(key);
  };

  pause = () => {
    process.stdin.pause();
  };

  resume = () => {
    process.stdin.resume();
  }
}

const initializeTerminal = () => {
  if (process.stdin.isTTY) process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
}

initializeTerminal();

const editor = new ShellLineEditor({
  input: process.stdin,
  output: process.stdout,
  promptLabel: "$ ",
  onSubmit: async (line) => {
    await executeCommand(line);
    editor.prompt();
  }
});

editor.start();
editor.prompt();

const restoreTerminal = () => {
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
  }
};

process.on('exit', restoreTerminal);
process.on('SIGINT', () => {
  restoreTerminal();
  process.exit();
});
process.on('uncaughtException', (err) => {
  restoreTerminal();
  console.error(err);
  process.exit(1);
});

const executeCommand = async (input: string) => {
  const inputTrimmed = input.trim();
  if (inputTrimmed === '') {
    return;
  }

  const {
    command, args, stdoutRedirect, stderrRedirect, isAppend,
  } = commandParser(inputTrimmed);

  if (!builtinFunctions.has(command)) {
    const commandPath = await findPath(command);
    if (!commandPath) {
      writeStdErr(`${command}: command not found\n`, isAppend, stderrRedirect);
      return;
    } else {
      editor.pause();
      if (process.stdin.isTTY) process.stdin.setRawMode(false);

      try {
        await runExternalCommand(commandPath, command, args, isAppend, stdoutRedirect, stderrRedirect);
      } finally {
        if (!terminalEndsWithNewline) {
          process.stdout.write('\n');
          terminalEndsWithNewline = true;
        }

        if (process.stdin.isTTY) process.stdin.setRawMode(true);
        editor.resume();
      }
      return;
    }
  }

  if (command === 'exit') {
    editor.close();
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
}

const builtinFunctions = new Set(['exit', 'echo', 'type', 'pwd', 'cd']);
const paths = process.env.PATH?.split(path.delimiter) || '';
const home = os.homedir();
let terminalEndsWithNewline = true;

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
        try {
          outputFile = await fs.open(stdoutRedirect, isAppend ? 'a' : 'w');

          child.stdout.on('data', (chunk) => {
            if (isAppend) {
              outputFile?.appendFile(chunk);
            } else {
              outputFile?.write(chunk);
            }
          });
        } catch (err) {
          if (!(isErrnoException(err) && err.code === "ENOENT")) {
            if (err instanceof Error) throw new Error(err.message);
            throw new Error("Erro desconhecido");
          }
        }
      } else {
        child.stdout.on('data', (chunk) => {
          process.stdout.write(chunk);
          updateTerminalLineState(chunk);
        });
      }
    }

    if (child.stderr) {
      if (stderrRedirect) {
        try {
          errOutputFile = await fs.open(stderrRedirect, isAppend ? 'a' : 'w');

          child.stderr.on('data', (chunk) => {
            if (isAppend) {
              errOutputFile?.appendFile(chunk);
            } else {
              errOutputFile?.write(chunk);
            }
          });
        } catch (err) {
          if (!(isErrnoException(err) && err.code === "ENOENT")) {
            if (err instanceof Error) throw new Error(err.message);
            throw new Error("Erro desconhecido");
          }
        }
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

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
