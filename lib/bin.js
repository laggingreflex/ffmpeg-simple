#!/usr/bin/env node

const yargs = require('yargs');
const { name } = require('../package');
const { ffmpeg, ffprobe } = require('.');
const { concat } = require('.');
const { concatDemux } = require('.');
const { cut } = require('.');
const { sample } = require('.');
const { rotateMeta } = require('.');
const _ = require('./utils');

yargs.scriptName(name);
yargs.options({
  input: { type: 'string' },
  inputs: { type: 'array' },
  output: { type: 'string' },
});

yargs.command({
  command: ['convert [input]', '$0 [input]'],
  default: true,
  desc: 'Convert file',
  handler: opts => ffmpeg(opts),
});

yargs.command({
  command: 'probe [input]',
  desc: 'Probe file',
  handler: async opts => {
    const data = await ffprobe({ ...opts, });
    console.log(JSON.stringify(data, null, 2));
  },
});

yargs.command({
  command: 'concat [inputs..]',
  desc: 'Concatenate files',
  handler: argv => {
    if (argv.demux) {
      return concatDemux(argv);
    } else {
      return concat(argv);
    }
  },
});

yargs.command({
  command: 'cut [input]',
  desc: 'Cut file',
  handler: cut,
});

yargs.command({
  command: 'sample',
  desc: 'Sample file',
  handler: sample,
});

yargs.command({
  command: 'rotateMeta [input] [rotateMeta]',
  aliases: ['rotatemeta', 'rotate-meta', 'rm'],
  desc: 'Rotate by adding rotate metadata',
  handler: rotateMeta,
});

try {
  yargs.config(require(_.normalize('~/ffmpeg-simple.json')));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') {
    throw error;
  }
}

const config = yargs.argv;

if (config.lowPriority !== false) {
  require('os').setPriority(0, 19);
}

