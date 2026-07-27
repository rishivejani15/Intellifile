const path = require('path');
const fs = require('fs');

function getPathFromArgv(argv) {
  if (!Array.isArray(argv)) return null;
  for (let i = argv.length - 1; i >= 0; i--) {
    let arg = argv[i];
    if (!arg) continue;
    
    // Chrome uses /select,"C:\path" or --select,C:\path
    if (arg.toLowerCase().startsWith('/select,')) {
      arg = arg.substring(8);
      if (arg.startsWith('"') && arg.endsWith('"')) {
        arg = arg.substring(1, arg.length - 1);
      }
    } else if (arg.toLowerCase().startsWith('--select,')) {
      arg = arg.substring(9);
      if (arg.startsWith('"') && arg.endsWith('"')) {
        arg = arg.substring(1, arg.length - 1);
      }
    }

    if (arg.startsWith('-')) continue;
    if (arg === '.' || arg.endsWith('main.js') || arg.toLowerCase().endsWith('electron.exe') || arg.toLowerCase().endsWith('electron')) continue;
    
    // Just for testing, ignore the fs.existsSync check so it returns the path
    if (path.isAbsolute(arg)) {
      return arg;
    }
  }
  return null;
}

const testArgs = [
  'C:\\Users\\meet1\\OneDrive\\Desktop\\Intellifile\\frontend\\node_modules\\electron\\dist\\electron.exe',
  'main.js',
  '/select,"C:\\Users\\meet1\\Downloads\\abcddd.jpg"'
];

console.log('Result:', getPathFromArgv(testArgs));

const testArgs2 = [
  'C:\\Users\\meet1\\OneDrive\\Desktop\\Intellifile\\frontend\\node_modules\\electron\\dist\\electron.exe',
  'main.js',
  '/select,C:\\Users\\meet1\\Downloads\\abcddd.jpg'
];

console.log('Result2:', getPathFromArgv(testArgs2));
