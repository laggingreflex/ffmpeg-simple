const Path = require('path');
const fs = require('fs-extra');
const Ffmpeg = require('fluent-ffmpeg');
const { confirm, select, prompt } = require('enquire-simple');
const glob = require('glob');
const ffprobe = require('./ffprobe');
const _ = require('./utils');
const Error = _.Error;

let userConfig;
let userPresets;
try {
  userConfig = require(_.normalize('~/ffmpeg-simple.json'));
  userPresets = userConfig.presets;
  delete userConfig.presets;
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') {
    throw error;
  }
}

const Exports = main;
Exports.ffmpeg = Exports;
Exports.initializeOpts = initializeOpts;
Exports.applyOptions = applyOptions;
Exports.checkOutput = checkOutput;
Exports.probeOutput = probeOutput;
Exports.probeOutput = probeOutput;
module.exports = Exports;

/**
 * @param {Object} opts
 * @param {String} [opts.input] Input
 * @param {String} [opts.output] Output
 * @param {Number} [opts.from]
 * @param {String} [opts.format] Format
 * @param {String} [opts.codec] Video Codec
 * @param {Array} [opts.inputOptions] FFMPEG input options
 * @param {Array} [opts.outputOptions] FFMPEG output options
 * @param {Boolean} [opts.silent] Whether to log messages
 * @param {Number} [opts.rotateMeta]
 * @param {String} [opts.subtitles]
 * @param {('burn'|'stream')} [opts.subtitlesMode=burn]
 * @param {Number} [opts.to]
 * @param {Number} [opts.duration]
 * @param {Boolean} [opts.audio]
 * @param {ffmpegCallback} [opts.ffmpeg] ffmpeg callback
 * @param {onProgressCallback} [opts.onProgress] onProgress callback
 */
async function main(opts) {
  opts = await initializeOpts(opts);
  opts?.backChannel.emit('initializeOpts', opts);

  /* Initialize ffmpeg */
  const ffmpeg = Ffmpeg({
    logger: console,
    // stdoutLines: 1000,
    ...opts,
  });
  opts?.backChannel.emit('initializeFfmpeg', ffmpeg);

  await applyOptions(ffmpeg, opts);
  opts?.backChannel.emit('applyOptions', ffmpeg);

  if (typeof opts.ffmpeg === 'function') {
    let ret = await opts.ffmpeg(ffmpeg, opts);
    ret = ret || {};
    const configuredOutput = ffmpeg?._currentOutput?.target;
    if (configuredOutput && configuredOutput !== opts.output) {
      console.warn(
        `Warning: Specified output ('${opts.output}') different from configured output ('${configuredOutput}')`
      );
    }
  }

  const checkOutputResult = await checkOutput(opts);
  opts?.backChannel.emit('checkOutput', checkOutputResult);

  if (checkOutputResult.cancelled)
    throw new Error(`User Cancelled: '${opts.input}'`);
  if (checkOutputResult.skipped) return;

  /* Attach loggers */
  // ffmpeg.on('start', console.log);
  ffmpeg.on('start', onStart(opts));

  const onProgress_ = onProgress(opts);
  if (opts.verbose) {
    console.log('logging verbose');
    ffmpeg.on('stderr', console.error);
    ffmpeg.on('stdout', console.log);
  } else {
    ffmpeg.on('progress', onProgress_);
  }

  /* Run */

  if (opts.output) {
    if (!ffmpeg?._currentOutput?.target) ffmpeg.output(opts.output);
    if (opts.output !== ffmpeg?._currentOutput?.target) {
      console.warn(
        `Warning: opts.output (='${opts.output}') !== ffmpeg.output(='${ffmpeg?._currentOutput?.target}')`
      );
    }
    try {
      await fs.ensureDir(Path.dirname(ffmpeg?._currentOutput?.target));
    } catch (error) {
      console.log('WARNING:', error.message);
    }
  } else {
    if (ffmpeg?._currentOutput?.target) {
      //
    } else {
      console.warn('WARN Output undefined');
    }
  }

  const whenStarted = new Promise((x) => ffmpeg.on('start', x));

  ffmpeg.run();

  // console.log('Not actually doing');
  // return opts.output;
  onProgress_();

  /* Handle interruptions */

  whenStarted.then(() => {
    opts?.backChannel.emit('start', ffmpeg);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', async (input) => {
      const string = String(input).trim().toLowerCase();
      ffmpeg.ffmpegProc.stdin.write(input);
      if (string.startsWith('q')) {
        console.error(`Quitting... ('q' was pressed)`);
      }
    });
  });
  opts?.backChannel?.on?.('quit', () => {
    ffmpeg.ffmpegProc.stdin.write('q');
  });

  /* Wait for end */
  const start = new Date();
  let error;
  const whenEnded = Promise.race([
    new Promise((_) => ffmpeg.once('end', _)),
    new Promise((_, x) => ffmpeg.once('error', x)),
  ]);

  whenEnded.finally(() => {
    process.stdin.pause();
  });

  try {
    await whenEnded;
    console.log(/* Empty line in case progress log don't get overwritten by whatever logs next */);
  } catch (e) {
    console.log(e);
    // error = e.stack
    // error = e.stderr
    throw e;
  }

  opts?.backChannel.emit('end', ffmpeg);

  if ('rotateMeta' in opts) {
    const input = opts.output;
    const output = _.pathFrom(input, { extname: (e) => '_rotated' + e });
    /* Adding metadata when encoding doesn't work. So re-encoding */
    /* https://stackoverflow.com/questions/50880264/ffmpeg-ignores-metadata-option-when-video-is-encoded */
    if (!opts.silent) {
      console.log('Rotating...');
    }
    await main({
      input,
      output,
      codec: 'copy',
      outputOptions: ['-metadata:s:v', `rotate=${opts.rotateMeta}`],
      silent: true,
    });
    await _.remove(input, { silent: true });
    await fs.rename(output, input);
    opts?.backChannel.emit('rotateMeta', ffmpeg);
  }

  const processDuration = new Date() - start;
  const processDurationString = _.humanDuration(processDuration);

  let outputProbe;
  try {
    outputProbe = await probeOutput(opts);
  } catch (error) {
    if (!opts.silent) {
      console.warn(
        `Warning: Couldn't probe output '${opts.output}'. ${error.message}`
      );
    }
  }

  if (!opts.silent) {
    if (outputProbe) {
      outputProbe.log();
    }
    console.log(`Done (in ${processDurationString})!`);
  }

  if (opts.replace) {
    const tmp = _.pathFrom(opts.input, { extname: (e) => '_replace' + e });
    await fs.rename(opts.input, tmp);
    const errors = new Error(`Couldn't replace input with output`);
    try {
      await fs.rename(opts.output, opts.input);
    } catch (error) {
      errors.renameError = error;
      try {
        await fs.move(opts.output, opts.input);
      } catch (error) {
        errors.moveError = error;
        try {
          await fs.rename(tmp, opts.input);
        } catch (error) {
          errors.restoreInputError = error;
        }
        throw errors;
      }
    }
    await fs.remove(tmp);
    opts?.backChannel.emit('replace', ffmpeg);
  }

  /* Return output */
  return opts.output;
  return { path: opts.output, ...outputProbe, processDuration };
  return opts.output;
}

function initializeMain(opts) {}

async function initializeOpts(opts) {
  /* Initialize Options */
  if (typeof opts === 'string') opts = { input: opts };
  if (typeof opts === 'function') opts = { ffmpeg: opts };
  // if (!opts.ffmpeg)
  //   throw new Error('Need opts.ffmpeg callback')

  Object.assign(opts, userConfig);
  if (userPresets?.[opts.preset]) {
    const preset = opts.preset;
    delete opts.preset;
    Object.assign(opts, userPresets[preset]);
  }

  if (opts.inputs) opts.input = opts.inputs;

  if (!opts.input || !opts.input?.length) {
    throw new Error('Need at least 1 input');
  }

  if (!opts.output) {
    let input =
      opts.inputs?.[0] ??
      (Array.isArray(opts.input) ? opts.input?.[0] : undefined) ??
      opts.input;
    let extension = opts?.extension ?? 'mp4';
    if (!extension?.startsWith?.('.')) extension = '.' + extension;
    // console.log(`input:`, input)
    if (input.input) input = input.input;
    if (typeof input === 'string') {
      opts.output = _.pathFrom(input, {
        extname: (e) => (opts.outputSuffix ?? '_converted') + (extension ?? e),
      });
    } else {
      throw new Error(`Need an output`);
    }
  }

  if (opts.outputPrefix && !opts.output.startsWith(opts.outputPrefix)) {
    opts.output = opts.outputPrefix + opts.output;
  }

  // console.log(`opts:`, opts)
  // console.log(`input:`, input)
  // console.log(`opts.output:`, opts.output)

  const result = opts;
  // const outputExists = await fs.exists(opts.output);
  // if (outputExists) {
  //   if (opts.skip) throw new Error('Output exists, skip option enforced');
  //   if (opts.overwrite) {
  //     await trash(result.output);
  //   } else {
  //     let outputProbe;
  //     try { outputProbe = await ffprobe({ input: opts.output }) } catch (x) {}
  //     await select({
  //       message: [
  //         `Output exists: "${result.output}"`,
  //         result.probe ? `(${_.humanSize(result.probe.size)}|${_.humanDuration(result.probe.duration*1000)})` : `(unreadable)`
  //       ].filter(Boolean).join(' '),
  //       choices: {
  //         async overwrite() {
  //           await trash(result.output);
  //         },
  //         async cancel() {
  //           // result.cancelled = true;
  //           // return false;
  //           throw new Error('User Cancelled');
  //         },
  //         async rename() {
  //           let suggestedNewName;
  //           let i = 0;
  //           while (true) {
  //             i++;
  //             suggestedNewName = _.pathFrom(opts.output, { extname: e => ` (${i})` + e });
  //             if (await fs.exists(suggestedNewName)) continue;
  //             if (i > 100) {
  //               suggestedNewName = opts.output;
  //               // throw new Error(`Couldn't find a new valid name`);
  //             }
  //             opts.output = suggestedNewName;
  //             break;
  //           }
  //           const enteredNewName = await prompt('output:', suggestedNewName);
  //           opts.output = enteredNewName;
  //         },
  //       }
  //     });
  //   }
  // }

  return opts;
}

async function applyOptions(ffmpeg, opts) {
  // console.log('applyOptions', {ffmpeg, opts, 'ffmpeg.options.outputOptions': ffmpeg.options.outputOptions})
  // process.exit()
  /* Apply Options */
  let videoFilters = [];
  let audioFilters = [];
  let filterComplex = [];

  if (Array.isArray(opts.input)) {
    for (const input of opts.input) {
      if (input?.input) {
        await applyOptions(ffmpeg, {
          ...input,
          ...input?.opts,
        });
      } else {
        await ffmpeg.input(input);
      }
    }
  } else if (opts.input) {
    await ffmpeg.input(opts.input);
  }

  const inputs = _.arrify(opts.input);
  // for (const input of inputs) {
  //   if (input?.input) {
  //     await applyOptions(ffmpeg, {
  //       // ...opts,
  //       ...input,
  //       ...input?.opts,
  //     });
  //     return;
  //   } else {
  //     await ffmpeg.input(input);
  //   }
  //   // await ffmpeg.input(input?.input ?? input);
  // }

  let inputProbes = [];
  try {
    inputProbes = await Promise.all(inputs.map(_.throat(ffprobe)));
  } catch (error) {
    console.error('WARNING:', error.message);
  }
  for (let i = 0; i < inputs.length; i++) {
    const input = inputs[i];
    const inputMetadata = inputProbes[i];
    if (Array.isArray(opts.inputMetadata)) {
      opts.inputMetadata[i] = inputMetadata;
    } else if (opts.inputMetadata) {
      opts.inputMetadata = [opts.inputMetadata, inputMetadata];
    } else {
      opts.inputMetadata = inputMetadata;
    }
    opts.inputDuration =
      (opts?.inputDuration ?? 0) + (inputMetadata?.duration ?? 0);
    opts.inputSize = (opts?.inputSize ?? 0) + (inputMetadata?.size ?? 0);
  }
  // console.log(`opts:`, opts);
  // if (opts.input) {
  //   ffmpeg.input(opts.input);
  //   opts.inputMetadata = await ffprobe(opts.input);
  //   opts.inputDuration = opts.inputDuration || opts.inputMetadata.duration;
  //   opts.inputSize = opts.inputSize || opts.inputMetadata.size;
  // } else if (opts.inputs) {
  //   opts.inputsMetadata = await Promise.all(opts.inputs.map(input => {
  //     ffmpeg.input(input);
  //     return ffprobe(input);
  //   }));
  //   opts.inputDuration = opts.inputsMetadata.reduce((p, c) => p + c.duration || 0, 0);
  //   opts.inputSize = opts.inputsMetadata.reduce((p, c) => p + c.size || 0, 0);
  // }
  if (opts.inputOptions) ffmpeg.inputOptions(opts.inputOptions);
  // if (opts.ss)
  //   ffmpeg.inputOptions('-ss', opts.ss);
  if (opts.from) ffmpeg.inputOptions('-ss', opts.from);
  if (opts.filterComplex) filterComplex.push(..._.arrify(opts.filterComplex));
  // console.debug(`opts:`, opts)
  // ffmpeg.outputOptions('-filter_complex', opts.filterComplex);
  if (opts.codec) ffmpeg.outputOptions('-c', opts.codec);
  else if (opts.videoCodec) ffmpeg.videoCodec(opts.videoCodec);
  else if (opts.copy) ffmpeg.outputOptions('-c', 'copy');
  if (opts.crf) ffmpeg.outputOptions('-crf', opts.crf);
  if (opts.quality) ffmpeg.outputOptions('-cq:v', opts.quality);
  if (opts.videoQuality) ffmpeg.outputOptions('-cq:v', opts.videoQuality);
  if (opts.cpuUsed) ffmpeg.outputOptions('-cpu-used', opts.cpuUsed);
  if (opts.scale || opts.videoScale)
    filterComplex.push(`scale=${opts.scale || opts.videoScale}`);
  if (opts.crop) {
    if (typeof opts.crop === typeof 'string') {
      filterComplex.push(`crop=${opts.crop}`);
    } else {
      filterComplex.push({ filter: 'crop', options: opts.crop });
    }
  }
  if (opts.hflip) filterComplex.push('hflip');
  if (opts.vflip) filterComplex.push('vflip');
  if (opts.audioBitrate) ffmpeg.outputOptions('-b:a', opts.audioBitrate);
  if (opts.audioChannel) ffmpeg.outputOptions('-ac', opts.audioChannel);
  if (opts.codecLevel) ffmpeg.outputOptions('-crf', opts.codecLevel);
  if (opts.audio === false) ffmpeg.outputOptions('-an');
  if (opts.video === false) ffmpeg.outputOptions('-vn');
  if (opts.rotate) {
    let angle = opts.rotate;
    if (Math.abs(angle) > Math.PI) {
      angle *= Math.PI / 180;
    }
    // ffmpeg.outputOptions('-vf', `rotate=${opts.rotate}`);
    // videoFilters.push(`rotate=${opts.rotate}`);
    filterComplex.push(`rotate=${angle}`);
  }
  if (opts.transpose) {
    filterComplex.push(`transpose=${opts.transpose}`);
  }
  if (opts.subtitles) {
    if (!(await fs.exists(opts.subtitles))) {
      const guess = _.pathFrom(opts.input, { extname: '.srt' });
      if (await fs.exists(guess)) {
        opts.subtitles = guess;
      } else {
        throw new Error(`Invalid subtitles: ${opts.subtitles}`);
      }
    }
  }

  if (opts.subtitles) {
    if (!opts.subtitlesMode) {
      if (opts.codec === 'copy') {
        opts.subtitlesMode = 'stream';
      }
    }
    const subtitlesMode = opts.subtitlesMode || 'burn';
    if (subtitlesMode === 'stream') {
      ffmpeg.input(opts.subtitles);
      ffmpeg.inputOptions('-f', 'srt');
      ffmpeg.inputOptions('-err_detect ignore_err');
      // if (opts.ss)
      //   ffmpeg.inputOptions('-ss', opts.ss);
    } else if (subtitlesMode === 'burn') {
      let subtitles = opts.subtitles;
      /* https://superuser.com/questions/1247197/ffmpeg-absolute-path-error */
      // subtitles = subtitles.replace(/([:\\])/g, '\\\\$1')
      subtitles = subtitles.replace(/\\/g, '/');
      subtitles = subtitles.replace(/:/g, '\\\\:');
      let filter = `subtitles=${subtitles}`;
      if (opts.force_style) filter += ':' + opts.force_style;
      filterComplex.push(`subtitles=${subtitles}`);
      // filterComplex.push({ subtitles });
    } else {
      throw new Error(
        `Invalid subtitles mode: '${subtitlesMode}'. Need to be either "burn" or "stream"`
      );
    }
  }
  if (opts.speed) {
    // ffmpeg.outputOptions('-vf', `setpts=(PTS-STARTPTS)/${opts.speed}`);
    // videoFilters.push(`setpts=(PTS-STARTPTS)/${opts.speed}`);
    filterComplex.push(`setpts=(PTS-STARTPTS)/${opts.speed}`);
    if (opts.audio !== false) {
      const { n, multiplier } = findExponent(opts.speed);
      audioFilters.push(
        Array.from(Array(n))
          .map((x) => `atempo=${multiplier}`)
          .join(',')
      );
      // ffmpeg.outputOptions('-af', Array.from(Array(n)).map(x => `atempo=${multiplier}`).join(','));
      // ffmpeg.outputOptions('-af', `asetrate=r=${48*options.speed}K`);
    }
  }
  if (opts.framerate) {
    const inputFramerate = opts?.inputMetadata.framerate;
    if (!inputFramerate || inputFramerate > opts.framerate) {
      ffmpeg.outputOptions('-r', opts.framerate);
    }
  }
  if (opts.fps) ffmpeg.outputOptions('-r', opts.fps);
  if (opts.preset) ffmpeg.outputOptions('-preset', opts.preset);
  if (opts.t) ffmpeg.outputOptions('-t', opts.t);
  if (opts.duration) ffmpeg.outputOptions('-t', opts.duration);
  if (opts.ss) ffmpeg.outputOptions('-ss', opts.ss);
  if (opts.to) ffmpeg.outputOptions('-to', opts.to);
  // console.log(`ffmpeg.options.outputOptions:`, ffmpeg.options.outputOptions);
  if (opts.outputOptions) ffmpeg.outputOptions(...opts.outputOptions);
  // console.log(`ffmpeg.options.outputOptions:`, ffmpeg.options.outputOptions);
  if (videoFilters.length) {
    videoFilters = verticalAdjust(opts, _.dedupe(videoFilters));
    console.debug(`videoFilters:`, videoFilters);
    ffmpeg.outputOptions('-vf', videoFilters.join(','));
  } else if (filterComplex.length) {
    filterComplex = verticalAdjust(opts, _.dedupe(filterComplex));
    console.debug(`filterComplex:`, filterComplex);
    ffmpeg.outputOptions('-filter_complex', filterComplex.join(','));
    // ffmpeg.complexFilter(filterComplex);
  } else {
    console.debug(`no filters`);
  }
  if (audioFilters.length) ffmpeg.outputOptions('-af', audioFilters.join(';'));
  if (opts.rotateMeta) {
    /* https://stackoverflow.com/questions/50880264/ffmpeg-ignores-metadata-option-when-video-is-encoded */
    // ffmpeg.outputOptions('-metadata:s:v', `rotate=${opts.rotateMeta}`)
  }
  // ffmpeg.outputOptions('-max_muxing_queue_size 512');

  if (opts?.inputMetadata?.title) {
    ffmpeg.outputOptions('-metadata', `title=${opts?.inputMetadata?.title}`);
  }
  if (opts?.inputMetadata?.artist) {
    ffmpeg.outputOptions('-metadata', `artist=${opts?.inputMetadata?.artist}`);
  }
  if (opts?.inputMetadata?.date) {
    ffmpeg.outputOptions('-metadata', `date=${opts?.inputMetadata?.date}`);
  }
  if (opts?.inputMetadata?.comment) {
    ffmpeg.outputOptions(
      '-metadata',
      `comment=${opts?.inputMetadata?.comment}`
    );
  }
  if ('rotateMeta' in opts) {
    ffmpeg.outputOptions('-metadata:s:v', `rotate=${opts.rotateMeta}`);
  }
}

async function checkOutput(opts) {
  const result = {};
  try {
    if (typeof opts === 'string') opts = { input: opts };
    Object.assign(result, opts);
    if (!opts.output) {
      result.output =
        opts.output ||
        _.pathFrom(opts.input, {
          extname: (e) => (opts.outputSuffix ?? '_converted') + e,
        });
      if (opts.outputPrefix) {
        result.output = opts.outputPrefix + result.output;
      }
    }
    result.exists = await fs.exists(result.output);
    try {
      result.probe = await ffprobe({ input: result.output });
    } catch (x) {
      result.probe = false;
    }
    // console.log(`result:`, result);
    // process.exit()

    if (result.exists && opts.skip) {
      result.skipped = true;
      return;
    }

    if (result.exists) {
      if (opts.overwrite) {
        await overwrite();
      } else if (opts.quiet) {
        result.unanswered = true;
        result.ok = false;
      } else {
        await ask();
      }
    }

    opts.output = result.output;

    if (result.cancelled) return;

    if (result !== false) result.ok = true;
  } catch (error) {
    result.error = error;
    error.result = result;
  } finally {
    if (result.error && opts.halt !== false) throw result.error;
    return result;
  }

  function ask() {
    return select({
      message: [
        `Output exists: "${result.output}"`,
        result.probe
          ? `(${_.humanSize(result.probe.size)}|${_.humanDuration(
              result.probe.duration * 1000
            )})`
          : `(unreadable)`,
      ]
        .filter(Boolean)
        .join(' '),
      choices: {
        overwrite,
        cancel,
        rename,
      },
    });
  }

  function overwrite() {
    // return fs.remove(output);
    return _.remove(result.output);
  }

  function cancel() {
    result.cancelled = true;
    // return false;
    // throw new Error('User Cancelled');
  }

  async function rename() {
    let i = 0;
    while (true) {
      i++;
      const newName = _.pathFrom(result.output, {
        extname: (e) => ` (${i})` + e,
      });
      if (await fs.exists(newName)) continue;
      if (i > 100) throw new Error(`Couldn't find a new valid name`);
      result.output = newName;
      break;
    }
  }
}

async function isProbeable(input) {
  try {
    await ffprobe({ input });
    return true;
  } catch (error) {
    return false;
  }
}

async function probeOutput(opts) {
  let probe;
  try {
    probe = await ffprobe({ input: opts.output });
  } catch (error) {
    if (opts.halt === false) return { error };
    else throw error;
  }
  // probe.duration *= opts.speed || 1;
  const diff = {};
  diff.size = probe.size / opts.inputSize;
  diff.sizeString = _.diffString(probe.size, opts.inputSize);
  diff.duration = probe.duration / opts.inputDuration;
  diff.durationString = _.diffString(probe.duration, opts.inputDuration);
  diff.isSizeSignificant = diff.size < 0.95 || 1.05 < diff.size;
  diff.isDurationSignificant = diff.duration < 0.95 || 1.05 < diff.duration;

  function log(
    { output = 'Output: ', size = 'Size: ', duration = 'Duration: ' } = {},
    logger = console.log
  ) {
    logger(
      [
        `${output}"${opts.output}"`,
        diff.isSizeSignificant &&
          `${size}${_.humanSize(probe.size)} (${
            diff.sizeString
          } of ${_.humanSize(opts.inputSize)})`,
        diff.isDurationSignificant &&
          `${duration}${_.humanDuration(probe.duration * 1000)} (${
            diff.durationString
          } of ${_.humanDuration(opts.inputDuration * 1000)})`,
      ]
        .filter(Boolean)
        .join('\n')
    );
  }
  return { ...probe, diff, log };
}

function onStart(opts) {
  return (...args) => {
    if (opts.onStart) {
      opts.onStart(...args);
    } else if (!opts.silent) {
      console.log(...args);
    }
    // console.log(...args);
  };
}

function onProgress(opts = {}) {
  const eta = _.eta();
  return (progress = {}) => {
    const pretty = {};
    let supposedOutputDuration = opts.inputDuration / (opts.speed || 1);
    // if (progress.timemark) {
    //   const time = progress.timemark.split(':').reverse();
    //   let duration = 0;
    //   for (let i = 0; i < time.length; i++) {
    //     const element = time[i];
    //     duration += element * (60 ** i);
    //   }
    //   duration = _.minmax(duration);
    //   progress.duration = duration;
    //   progress.percentFull = duration / supposedOutputDuration;
    //   progress.percent = _.percent(progress.percentFull);
    //   pretty.percent = `${progress.percent}%`;
    //   // pretty.timemark = progress.timemark;
    // }
    progress.percent = Math.min(Math.max(progress.percent || 0, 0), 100);
    progress.percentFull = progress.percent / 100;
    progress.percent = _.percent(progress.percentFull);
    pretty.percent = `${progress.percent}%`;
    if (progress.percentFull) {
      const ratio = (progress.ratio = _.ratio(progress.percentFull));
      Object.assign(progress, eta({ ratio }));
      pretty.remaining = `ETA: ${_.humanDuration(progress.remaining)}`;
      pretty.elapsed = `Elapsed: ${_.humanDuration(progress.elapsed)}`;
    }
    if (progress.targetSize) {
      progress.size = parseInt(_.minmax(progress.targetSize) * 1024);
      pretty.size = `Size: ${_.humanSize(progress.size)}`;
    }
    if (progress.currentKbps) {
      progress.bitrate = _.toFixed(progress.currentKbps);
      pretty.bitrate = `Bitrate: ${progress.bitrate} kbps`;
    }
    if (progress.currentFps) {
      progress.fps = _.toFixed(_.minmax(progress.currentFps));
      pretty.fps = `FPS: ${progress.fps}`;
    }
    // string.push(`${progress.currentKbps} kbps`);
    if (progress.timemark) {
      pretty.timemark = progress.timemark;
    }

    progress.pretty = pretty;
    progress.string = Object.values(pretty).join(' | ');

    if (opts.onProgress) {
      opts.onProgress(progress);
    } else if (!opts.silent) {
      _.stdoutLine(progress.string);
    }
  };
}

function findExponent(x) {
  /* from ffmpeg-speedup-video */
  for (let n = 1; n <= 10; n++) {
    const multiplier = Math.pow(10, Math.log10(x) / n);
    if (0.5 <= multiplier && multiplier <= 2) {
      return { n, multiplier };
    }
  }
  throw new Error(`Could not find a multiple in the range 1-10`);
}

function verticalAdjust(opts, filters) {
  // console.log(`opts.inputMetadata:`, opts.inputMetadata);
  // filter.unshift('transpose')
  if (opts?.inputMetadata?.height > opts?.inputMetadata?.width) {
    filters.unshift('transpose=1');
    for (let i = 0; i < filters.length; i++) {
      const filter = filters[i];
      if (filter === 'hflip') filters[i] = 'vflip';
      if (filter === 'vflip') filters[i] = 'hflip';
    }
    filters.push('transpose=2');
  }
  return filters;
}

function parseInputs(input) {
  const inputs = _.arrify(input);
  for (let i = inputs.length - 1; i >= 0; i--) {
    const input = inputs[i];
    if (input.includes('*')) {
      const paths = glob.sync(input);
      // console.log({ input, paths });
      if (paths.length) {
        inputs.splice(i, 1);
        for (const path of paths) {
          inputs.push(path);
        }
      } else {
      }
    }
  }
  return inputs;
  // return filterInputsWithPossibleOutputs(inputs);
}

function filterInputsWithPossibleOutputs(inputs) {
  const possibleOutputs = inputs.map((input) =>
    _.pathFrom(input, { extname: (e) => '_converted' + e })
  );
  const includedPossibleOutputs = [];
  for (const possibleOutput of possibleOutputs) {
    if (inputs.includes(possibleOutput)) {
      includedPossibleOutputs.push(possibleOutput);
      // console.log(`Skipping '${possibleOutput}'`);
    }
  }
  if (includedPossibleOutputs.length) {
    console.log(
      `Skipping ${includedPossibleOutputs.length} inputs that seem to be outputs of other inputs:`,
      includedPossibleOutputs
    );
  }
  const filtered = inputs.filter((i) => !includedPossibleOutputs.includes(i));
  // console.log({ inputs, possibleOutputs, includedPossibleOutputs, filtered });
  return filtered;
}

/**
 * @callback ffmpegCallback
 * @param {Ffmpeg} ffmpeg fluent-ffmpeg class instantiated ffmpeg object
 * @param {ffmpegCallbackOpts} opts
 */

/**
 * @typedef {object} ffmpegCallbackOpts
 * @property {string} input
 * @property {number} [inputIndex]
 */

/**
 * @callback onProgressCallback
 * @param {progressObject} progress
 */

/**
 * @typedef {object} progressObject
 * @property {string} string
 */
