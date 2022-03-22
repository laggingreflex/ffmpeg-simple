const OS = require('os');
const fs = require('fs-extra');
const Path = require('path');
const { confirm } = require('enquire-simple');
const Subtitle = require('subtitle');
const glob = require('glob');
const ffmpeg = require('./ffmpeg');
const ffprobe = require('./ffprobe');
const _ = require('./utils');

module.exports = { concatDemux, concat, sample, sample2, cut, rotateMeta, caption, batch, gif };

/**
 * @param {Object} opts
 */
async function concat({ ...opts }) {
  if (opts.log !== false) {
    console.log(`Concatenating ${opts.input.length} files...`);
  }
  return await ffmpeg({
    ...opts,
    filterComplex: `concat=n=${opts.input.length}:v=1:a=${opts.audio !== false ? 1 : 0}`,
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
    await ffmpeg({
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

async function rotateMeta(opts) {
  return ffmpeg({
    input: opts.input,
    // ...opts,
    outputOptions: ['-metadata:s:v', `rotate=${opts.rotateMeta}`],
    replace: true,
    codec: 'copy',
  });
}

async function caption(opts) {
  const probe = await ffprobe(opts.input);
  const subtitles = Path.join(_.defaults.tmpdir, +new Date + '.srt');
  await fs.writeFile(subtitles, Subtitle.stringify([{
    start: 0,
    end: probe.duration * 1000,
    text: opts.caption,
  }]));
  try {
    return await ffmpeg({ ...opts, subtitles });
  } finally {
    fs.remove(subtitles);
  }
}

async function batch(opts) {
  let inputs = _.arrify(opts.input).concat(_.arrify(opts.inputs)).reduce((inputs, input) => {
    if (input.includes('*')) {
      const paths = glob.sync(input);
      return inputs.concat(paths);
    }
    return inputs;
  }, []);

  delete opts.input;
  delete opts.inputs;

  console.log(`Checking ${inputs.length} inputs...`);

  let checkOutputResults = await _.promiseMapEta(inputs, input => ffmpeg.checkOutput({ ...opts, input, quiet: true }));
  const possibleOutputs = checkOutputResults.map(r => r.output);
  await _.promiseMapEta(possibleOutputs, input => ffprobe({ input, halt: false }));
  checkOutputResults = [];
  for (const input of inputs) {
    const checkOutputResult = await ffmpeg.checkOutput({ ...opts, input });
    checkOutputResults.push(checkOutputResult);
  }
  const possibleOutputsThatAreAlsoInputs = possibleOutputs.filter(output => inputs.includes(output));
  if (possibleOutputsThatAreAlsoInputs.length) {
    console.warn(`Skipping ${possibleOutputsThatAreAlsoInputs.length} inputs that seem to be outputs of other inputs:`, possibleOutputsThatAreAlsoInputs);
    inputs = inputs.filter(input => !possibleOutputsThatAreAlsoInputs.includes(input));
  }

  const nonOkOutputs = checkOutputResults.filter(c => !c.ok);
  if (nonOkOutputs.length) {
    const nonOkInputs = nonOkOutputs.map(c => c.input)
    console.log(`Skipping ${nonOkInputs.length} inputs:`, nonOkInputs);
    inputs = inputs.filter(input => !nonOkInputs.includes(input));
  }

  inputs = inputs.filter(input => {
    const checkOutputResult = checkOutputResults.find(c => c.input === input);
    return checkOutputResult.ok;
  })

  if (opts.sort) {
    const inputProbes = await _.promiseMapEta(inputs, ffprobe);
    inputs = _.sort(inputProbes, opts.sort).map(p => p.input);
  }

  console.log(`Processing ${inputs.length} inputs...`);

  const errors = [];
  const etaTotal = _.eta(inputs.length);
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    console.log(`[${i+1}/${inputs.length}] Processing input:`, input);
    const checkOutputResult = checkOutputResults.find(c => c.input === input);
    try {
      await ffmpeg({
        ...opts,
        input,
        output: checkOutputResult.output,
        onProgress(currentProgress) {
          const totalRatio = (i + currentProgress.ratio) / inputs.length;
          const totalProgress = etaTotal({ ratio: totalRatio });
          const message = [
            [
              totalProgress.percent && `${totalProgress.percent}%`,
              `[${i+1}/${inputs.length}]`,
              currentProgress.percent && `(current: ${currentProgress.percent}%)`,
            ].filter(Boolean).join(' '),
            `ETA: ${_.humanDuration(totalProgress.remaining || Infinity)} (current: ${_.humanDuration(currentProgress.remaining || Infinity)})`,
            `Elapsed: ${_.humanDuration(totalProgress.elapsed || 0)} (current: ${_.humanDuration(currentProgress.elapsed || 0)})`,
            currentProgress?.pretty?.size,
            currentProgress?.pretty?.bitrate,
            currentProgress?.pretty?.fps,
            currentProgress?.pretty?.timemark,
          ].filter(Boolean).join(' | ');
          _.stdoutLine(message);
        }
      });
    } catch (error) {
      if (opts.halt !== false) errors.push({ input, error });
      else throw error;
    }
  }
  const totalElapsed = _.humanDuration(etaTotal({ ratio: 1 }).elapsed);
  if (errors.length) {
    console.error(`Couldn't process ${errors.length} inputs:`);
    for (const error of errors) {
      console.error(error.input, error.error);
    }
    console.log(`${inputs.length-errors.length}/${inputs.length} done (in ${totalElapsed})!`);
    throw new Error(`${errors.length} failed`);
  } else {
    console.log(`All done (in ${totalElapsed})!`);
  }
}

async function gif(opts) {
  let pallet;
  try {
    console.log('Generating pallet...');
    pallet = await ffmpeg({
      ...opts,
      // output: pallet,
      outputOptions: ['-vf palettegen'],
      overwrite: true,
      outputSuffix: '_pallet',
      extension: '.png',
    });
    console.log(`pallet:`, pallet);
    console.log('Generating GIF using the pallet...');
    await ffmpeg({
      ...opts,
      input: undefined,
      inputs: [opts.input, pallet],
      outputOptions: ['-filter_complex paletteuse'],
      outputSuffix: '',
      extension: '.gif',
    });
  } finally {
    fs.remove(pallet);
  }
}
