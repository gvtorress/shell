import { createInterface } from "readline";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
});

const builtin_functions = new Set(['exit', 'echo', 'type']);

rl.prompt();

rl.on('line', (input) => {
  const arrCommand = input.split(' ');
  const command = arrCommand[0];

  if (command === 'exit') {
    rl.close();
    return;
  } else if (command === 'echo') {
    console.log(arrCommand.slice(1).join(' '));
  } else if (command === 'type') {
    const commandType = arrCommand[1];
    if (builtin_functions.has(commandType)) {
      console.log(`${commandType} is a shell builtin`);
    } else {
      console.log(`${commandType}: not found`);
    }
  } else {
    console.log(`${command}: command not found`);
  }
  rl.prompt();
});
