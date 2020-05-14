const OS = require('os');
const fs = require('fs-extra');
const ffmpeg = require('./ffmpeg');
const ffprobe = require('./ffprobe');
const { confirm } = require('enquire-simple');
const _ = require('./utils');

module.exports = { concatDemux, concat, sample, sample2, cut };

/**
 * @param {Object} opts
 */
async function concat({ ...opts }) {
  if (opts.log !== false) {
    console.log(`Concatenating ${opts.inputs.length} files...`);
  }
  return await ffmpeg({
    ...opts,
    filterComplex: `concat=n=${opts.inputs.length}:v=1:a=${opts.audio !== false ? 1 : 0}`,
  });
}
/**
 * @param {Object} opts
 * @param {String[]} opts.inputs
 * @param {String} opts.output
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

async function sample({ input, duration: totalDuration = 10, segments: numberOfSegments = 10 }) {
  input = _.normalize(input);
  const output = _.pathFrom(input, { extname: e => '_sample' + e });
  const tmpDir = _.pathFrom(input, { extname: e => '_sample.tmp' });

  if (await fs.exists(output)) {
    console.error(`Output exists: '${output}'`);
    if (!await confirm('Remove?')) return output;
  }

  try {
    const inputProbe = await ffprobe(input);

    // if (inputProbe.duration < 300) {
    //   throw new Error(`Pointless to sample videos < 5m`);
    // }

    for (let i = 0; i < numberOfSegments; i++) {
      const d = inputProbe.duration / numberOfSegments;
      const from = Math.floor(d * i);
      const duration = totalDuration / numberOfSegments;
      await ffmpeg({
        input,
        from,
        duration,
        codec: 'copy',
        audio: false,
        outputOptions: [
          '-f', 'segment',
          '-segment_time', duration,
        ],
        output: _.pathFrom(input, { dirname: tmpDir, extname: e => `${i}_%5d` + e }),
        silent: true,
      });
    }

    const segments = await _.readdir(tmpDir);

    return await concatDemux({
      inputs: segments,
      output,
    });

  } finally {
    try {
      await fs.remove(tmpDir);
    } catch (error) {
      console.warn(`Couldn't cleanup temp dir: "${tmpDir}". ${error}`);
    }
  }
}

async function sample2({ input }) {
  input = _.normalize(input);
  const inputPath = _.normalize(input);
  const inputStats = await _.stat(input);
  const inputProbe = await ffprobe(input);

  const outputs = {};
  outputs.cut = _.tmpFile('foc_' + inputPath.name + `_cut.mp4`);
  // const output = _.tmpFile('foc_' + inputPath.name + `_segment_${i}_%d.mp4`);
  outputs.segmentsDir = _.tmpFile('foc_' + inputPath.name + `_segments`);
  // outputs.segmentsDir = _.tmpFile('foc_' + inputPath.name + `_segments`, `%5d.mp4`);

  // await ffmpeg(ffmpeg => {
  //   ffmpeg.input(input);
  //   // ffmpeg.inputOptions('-ss', 10 * 60);
  //   ffmpeg.outputOptions('-f', 'segment');
  //   ffmpeg.outputOptions('-c', 'copy');
  //   // ffmpeg.outputOptions('-t', 5 * 3 * 60);
  //   ffmpeg.output(_.joinPath(outputs.segmentsDir, '/%5d.mp4'));
  // });

  outputs.segments = await fs.readdir(outputs.segmentsDir);

  const eachSegmentDuration = inputProbe.duration / outputs.segments.length;
  const durationNeeded = 60;
  const segmentsNeeded = 60 / eachSegmentDuration;
  const nthSegment = Math.floor(outputs.segments.length / segmentsNeeded);

  console.log({
    totalDuration: inputProbe.duration,
    segments: outputs.segments.length,
    eachSegmentDuration,
    durationNeeded,
    segmentsNeeded,
    nthSegment,
  });
  // return

  outputs.segmentsList = _.tmpFile('foc_' + inputPath.name + `_segmentsList.txt`);

  let segmentsList = outputs.segments
    // .filter((s, i) => !(i % 5))
    .filter((s, i) => !(i % nthSegment));
  segmentsList.push(outputs.segments[outputs.segments.length - 1]);
  segmentsList = segmentsList.map(f => `file '${_.joinPath(outputs.segmentsDir, f)}'`);
  fs.outputFile(outputs.segmentsList, segmentsList.join('\n'));

  await ffmpeg(ffmpeg => {
    ffmpeg.input(outputs.segmentsList);
    ffmpeg.inputOptions('-f', 'concat');
    ffmpeg.inputOptions('-safe', 0);
    ffmpeg.outputOptions('-c', 'copy');
    ffmpeg.output(outputs.cut);
  });

  // await fs.remove(outputs.segmentsDir);

}

async function cut({ ...opts }) {
  return ffmpeg({
    ...opts,
    codec: 'copy',
  });
}
