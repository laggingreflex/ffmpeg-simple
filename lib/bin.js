#!/usr/bin/env node

const yargs = require('yargs');
const { name } = require('../package');
const { ffmpeg, ffprobe } = require('.');

yargs.scriptName(name);
yargs.options({});

yargs.command({
  command: 'convert',
  desc: 'Convert file',
  handler: opts => ffmpeg(opts),
});

yargs.command({
  command: 'compress',
  desc: 'Compress file',
  handler: opts => ffmpeg({
    compress: true,
    ...opts,
  }),
});

yargs.command({
  command: 'probe',
  desc: 'Probe file',
  handler: opts => ffmpeg({
    compress: true,
    ...opts,
  }),
});

yargs.demandCommand();

yargs.argv;

// main().finally(e => {
//   process.exitCode = 1;
// });
