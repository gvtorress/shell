import { createInterface } from "readline";

const rl = createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "$ ",
});

rl.prompt();

rl.on('line', (command) => {
  if (command === 'exit') {
    rl.close();
    return;
  } else if (command.split(' ')[0] === 'echo') {
    console.log(command.split(' ').slice(1).join(' '));
  } else {
    console.log(`${command}: command not found`);
  }
  rl.prompt();
});
