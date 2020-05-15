#!/usr/bin/env node

const yargs = require('yargs');
const { name } = require('../package');
const { ffmpeg, ffprobe } = require('.');
const { concat } = require('.');
const { concatDemux } = require('.');
const { cut } = require('.');
const { sample } = require('.');
const _ = require('./utils');

yargs.scriptName(name);
yargs.options({
  input: { type: 'string' },
  inputs: { type: 'array' },
});

yargs.command({
  command: ['convert <input>', '$0 <input>'],
  default: true,
  desc: 'Convert file',
  handler: opts => ffmpeg(opts),
});

yargs.command({
  command: 'probe <input>',
  desc: 'Probe file',
  handler: async opts => {
    const data = await ffprobe({ ...opts, });
    console.log(JSON.stringify(data, null, 2));
  },
});

yargs.command({
  command: 'concat <inputs..>',
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
  command: 'cut <input>',
  desc: 'Cut file',
  handler: cut,
});

yargs.command({
  command: 'sample',
  desc: 'Sample file',
  handler: sample,
});

try {
  yargs.config(require(_.normalize('~/ffmpeg-simple.json')));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') {
    throw error;
  }
}

yargs.argv;
