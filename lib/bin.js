#!/usr/bin/env node

const yargs = require('yargs');
const { name } = require('../package');
const { ffmpeg, ffprobe } = require('.');
const { concat } = require('.');
const { concatDemux } = require('.');
const { cut } = require('.');
const { sample } = require('.');
const { rotateMeta } = require('.');
const { caption } = require('.');
const { batch } = require('.');
const _ = require('./utils');

yargs.scriptName(name);
yargs.options({
  input: { type: 'string', alias: ['i'], description: 'Input file' },
  inputs: { type: 'array', alias: [], description: 'Multiple input files' },
  output: { type: 'string', alias: [], description: 'Output file (default: <input-file>_converted)' },
  from: { type: 'number', alias: ['ss'], description: 'Start time offset' },
  to: { type: 'number', alias: [], description: 'Output stop time' },
  // format: { type: 'string', alias: [], description: 'Output stop time' },
  codec: { type: 'string', alias: ['c'], description: 'Codec' },
  videoCodec: { type: 'string', alias: [], description: 'Video Codec' },
  videoQuality: { type: 'string', alias: ['quality'], description: 'Video quality' },
  inputOptions: { type: 'array', alias: [], description: 'FFMPEG input options' },
  outputOptions: { type: 'array', alias: [], description: 'FFMPEG output options' },
  silent: { type: 'boolean', alias: [], description: 'Whether to log messages' },
  rotate: { type: 'number', alias: [], description: 'Rotate (-vfilters "rotate=90")' },
  rotateMeta: { type: 'string', alias: [], description: 'Rotate' },
  verbose: { type: 'boolean', alias: [], description: 'Show verbose logs' },
  help: { type: 'boolean', alias: 'h', description: 'Show help', },
  version: { type: 'boolean', alias: 'v', description: 'Show version number', },
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

yargs.command({
  command: 'caption [input] [caption]',
  desc: 'Add a caption',
  handler: caption,
});

yargs.command({
  command: 'batch [dir]',
  desc: 'Batch convert files in a dir',
  handler: batch,
});

let jsonConfig;
try {
  jsonConfig = require(_.normalize('~/ffmpeg-simple.json'));
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') {
    throw error;
  }
}

if (jsonConfig) yargs.config(jsonConfig);

const config = yargs.argv;

const preset = jsonConfig?.presets?. [config.preset];
if (preset) {
  delete config.preset;
  Object.assign(config, preset);
}

if (config.lowPriority !== false) {
  require('os').setPriority(0, 19);
}

if (!config.input && !config.inputs?.length) {
  throw new Error('Need at least 1 input');
}
