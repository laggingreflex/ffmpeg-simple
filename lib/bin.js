#!/usr/bin/env node

const yargs = require('yargs');
const { name } = require('../package');
const { ffmpeg, ffprobe } = require('.');

yargs.scriptName(name);
yargs.options({});

yargs.command({
  command: 'convert <file>',
  default: true,
  desc: 'Convert file',
  handler: opts => ffmpeg(opts),
});

// yargs.command({
//   command: 'compress',
//   desc: 'Compress file',
//   handler: opts => ffmpeg({
//     compress: true,
//     ...opts,
//   }),
// });

yargs.command({
  command: 'probe <input>',
  desc: 'Probe file',
  handler: async opts => {
    const data = await ffprobe({ ...opts, });
    console.log(JSON.stringify(data, null, 2));
  },
});

yargs.demandCommand();

yargs.argv;

// main().finally(e => {
//   process.exitCode = 1;
// });
