const OS = require('os');
const Path = require('path');
const fs = require('fs-extra');
const ffmpeg = require('./ffmpeg');
const ffprobe = require('./ffprobe');
const _ = require('./utils');

module.exports = { concatDemux, concat };

/**
 * @param {Object} opts
 */
async function concat({ ...opts }) {
  if (opts.log !== false) {
    console.log(`Concatenating ${opts.inputs.length} files...`);
  }
  await ffmpeg({
    ...opts,
    filterComplex: `concat=n=${opts.inputs.length}:v=1:a=${opts.audio !== false ? 1 : 0}`,
  });
}
/**
 * @param {Object} opts
 * @param {String[]} opts.inputs
 * @param {String} [opts.codec=copy]
 */
async function concatDemux({ inputs, ...opts }) {
  if (opts.log !== false) {
    console.log(`Concatenating ${inputs.length} files...`);
  }
  const inputsMetadata = await Promise.all(inputs.map(ffprobe));
  const inputDuration = inputsMetadata.reduce((p, c) => p + c.duration || 0, 0);
  const inputSize = inputsMetadata.reduce((p, c) => p + c.size || 0, 0);
  const list = inputs.map(file => `file '${file}'`);
  const input = _.pathFrom(opts.output, { dirname: OS.tmpdir(), extname: '.txt' })
  // Path.join(OS.tmpdir(), `ffmpeg-simple_concat_tmpfile_${+new Date}.txt`);
  await fs.writeFile(input, list.join('\n'));
  try {
    return await ffmpeg({
      input,
      inputsMetadata,
      inputSize,
      inputDuration,
      inputOptions: ['-f', 'concat', '-safe', 0],
      codec: 'copy',
      subtitlesMode: 'stream',
      ...opts,
    });
  } finally {
    fs.remove(input);
  }
}
