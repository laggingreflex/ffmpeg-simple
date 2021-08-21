const Path = require('path');
const fs = require('fs-extra');
const Ffmpeg = require('fluent-ffmpeg');
const { confirm, select } = require('enquire-simple');
const trash = require('trash');
const ffprobe = require('./ffprobe');
const _ = require('./utils');

module.exports = main;
module.exports.ffmpeg = module.exports;
module.exports.checkOutput = checkOutput;
module.exports.probeOutput = probeOutput;

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
  opts = initializeOpts(opts);

  /* Initialize ffmpeg */
  const ffmpeg = Ffmpeg({
    logger: console,
    // stdoutLines: 1000,
    ...opts
  });

  if (opts.ffmpeg) {
    let ret = await opts.ffmpeg(ffmpeg, { input: opts.input });
    ret = ret || {};
  }

  await applyOptions(ffmpeg, opts);
  if (await checkOutput(ffmpeg, opts) === false) return;

  /* Attach loggers */
  // ffmpeg.on('start', console.log);
  ffmpeg.on('start', onStart(opts));
  const onProgress_ = onProgress(opts)
  ffmpeg.on('progress', onProgress_);

  /* Run */
  ffmpeg.run();
  onProgress_();

  /* Wait for end */
  const start = new Date;
  let error;
  try {
    await Promise.race([
      new Promise(_ => ffmpeg.once('end', _)),
      new Promise((_, x) => ffmpeg.once('error', x)),
    ]);
  } catch (e) {
    console.log(e);
    // error = e.stack
    // error = e.stderr
    throw e;
  }

  if ('rotateMeta' in opts) {
    const input = opts.output;
    const output = _.pathFrom(input, { extname: e => '_rotated' + e });
    /* Adding metadata when encoding doesn't work. So re-encoding */
    /* https://stackoverflow.com/questions/50880264/ffmpeg-ignores-metadata-option-when-video-is-encoded */
    if (!opts.silent) {
      console.log('Rotating...');
    }
    await main({ input, output, codec: 'copy', outputOptions: ['-metadata:s:v', `rotate=${opts.rotateMeta}`], silent: true });
    // await fs.remove(input);
    await trash(input);
    await fs.rename(output, input);
  }

  const processDuration = new Date - start;
  const processDurationString = _.humanDuration(processDuration);

  let outputProbe;
  try {
    outputProbe = await probeOutput(opts);
  } catch (error) {
    if (!opts.silent) {
      console.warn(`Warning: Couldn't probe output '${opts.output}'. ${error.message}`);
    }
  }

  if (!opts.silent) {
    if (outputProbe) {
      outputProbe.log();
    }
    console.log(`Done (in ${processDurationString})!`);
  }

  if (opts.replace) {
    const tmp = _.pathFrom(opts.input, { extname: e => '_replace' + e });
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
  }

  /* Return output */
  return opts.output;
  return { path: opts.output, ...outputProbe, processDuration };
  return opts.output;
}

function initializeOpts(opts) {
  /* Initialize Options */
  if (typeof opts === 'string')
    opts = { input: opts };
  if (typeof opts === 'function')
    opts = { ffmpeg: opts };
  // if (!opts.ffmpeg)
  //   throw new Error('Need opts.ffmpeg callback')
  return opts
}

async function applyOptions(ffmpeg, opts) {
  /* Apply Options */
  const videoFilters = [];
  const audioFilters = [];
  const filterComplex = [];
  if (opts.input) {
    ffmpeg.input(opts.input);
    opts.inputMetadata = await ffprobe(opts.input);
    opts.inputDuration = opts.inputDuration || opts.inputMetadata.duration;
    opts.inputSize = opts.inputSize || opts.inputMetadata.size;
  } else if (opts.inputs) {
    opts.inputsMetadata = await Promise.all(opts.inputs.map(input => {
      ffmpeg.input(input);
      return ffprobe(input);
    }));
    opts.inputDuration = opts.inputsMetadata.reduce((p, c) => p + c.duration || 0, 0);
    opts.inputSize = opts.inputsMetadata.reduce((p, c) => p + c.size || 0, 0);
  }
  if (opts.inputOptions)
    ffmpeg.inputOptions(opts.inputOptions);
  // if (opts.ss)
  //   ffmpeg.inputOptions('-ss', opts.ss);
  if (opts.from)
    ffmpeg.inputOptions('-ss', opts.from);
  if (opts.filterComplex)
    filterComplex.push(..._.arrify(opts.filterComplex))
  // ffmpeg.outputOptions('-filter_complex', opts.filterComplex);
  if (opts.codec)
    ffmpeg.outputOptions('-c', opts.codec);
  else if (opts.videoCodec)
    ffmpeg.videoCodec(opts.videoCodec);
  else if (opts.copy)
    ffmpeg.outputOptions('-c', 'copy');
  if (opts.crf)
    ffmpeg.outputOptions('-crf', opts.crf);
  if (opts.quality)
    ffmpeg.outputOptions('-cq:v', opts.quality);
  if (opts.videoQuality)
    ffmpeg.outputOptions('-cq:v', opts.videoQuality);
  if (opts.codecLevel)
    ffmpeg.outputOptions('-crf', opts.codecLevel);
  if (opts.audio === false)
    ffmpeg.outputOptions('-an');
  if (opts.video === false)
    ffmpeg.outputOptions('-vn');
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
    if (!await fs.exists(opts.subtitles)) {
      const guess = _.pathFrom(opts.input, { extname: '.srt' });
      if (await fs.exists(guess)) {
        opts.subtitles = guess;
      } else {
        throw new Error(`Invalid subtitles: ${opts.subtitles}`)
      }
    }
  }

  if (opts.subtitles) {
    if (!opts.subtitlesMode) {
      if (opts.codec === 'copy') {
        opts.subtitlesMode = 'stream'
      }
    }
    const subtitlesMode = opts.subtitlesMode || 'burn';
    if (subtitlesMode === 'stream') {
      ffmpeg.input(opts.subtitles);
      ffmpeg.inputOptions('-f', 'srt');
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
      throw new Error(`Invalid subtitles mode: '${subtitlesMode}'. Need to be either "burn" or "stream"`);
    }
  }
  if (opts.speed) {
    // ffmpeg.outputOptions('-vf', `setpts=(PTS-STARTPTS)/${opts.speed}`);
    // videoFilters.push(`setpts=(PTS-STARTPTS)/${opts.speed}`);
    filterComplex.push(`setpts=(PTS-STARTPTS)/${opts.speed}`);
    if (opts.audio !== false) {
      const { n, multiplier } = findExponent(opts.speed);
      audioFilters.push(Array.from(Array(n)).map(x => `atempo=${multiplier}`).join(','));
      // ffmpeg.outputOptions('-af', Array.from(Array(n)).map(x => `atempo=${multiplier}`).join(','));
      // ffmpeg.outputOptions('-af', `asetrate=r=${48*options.speed}K`);
    }
  }
  if (opts.framerate)
    ffmpeg.outputOptions('-r', opts.framerate);
  if (opts.fps)
    ffmpeg.outputOptions('-r', opts.fps);
  if (opts.preset)
    ffmpeg.outputOptions('-preset', opts.preset);
  if (opts.t)
    ffmpeg.outputOptions('-t', opts.t);
  if (opts.duration)
    ffmpeg.outputOptions('-t', opts.duration);
  if (opts.ss)
    ffmpeg.outputOptions('-ss', opts.ss);
  if (opts.to)
    ffmpeg.outputOptions('-to', opts.to);
  if (opts.outputOptions)
    ffmpeg.outputOptions(opts.outputOptions);
  if (videoFilters.length)
    ffmpeg.outputOptions('-vf', videoFilters.join(','));
  else if (filterComplex.length)
    ffmpeg.outputOptions('-filter_complex', filterComplex.join(','));
  if (audioFilters.length)
    ffmpeg.outputOptions('-af', audioFilters.join(';'));
  if (opts.rotateMeta) {
    /* https://stackoverflow.com/questions/50880264/ffmpeg-ignores-metadata-option-when-video-is-encoded */
    // ffmpeg.outputOptions('-metadata:s:v', `rotate=${opts.rotateMeta}`)
  }
  // ffmpeg.outputOptions('-max_muxing_queue_size 512');
}

async function checkOutput(ffmpeg, opts) {
  const configuredOutput = ffmpeg?._currentOutput?.target;
  const specifiedOutput = opts.output;
  if (configuredOutput && configuredOutput != specifiedOutput) {
    console.warn(`Warning: Specified output different from configured output`, {
      'opts.output': specifiedOutput,
      'ffmpeg.output()': specifiedOutput,
    });
  }
  let output = configuredOutput || specifiedOutput || _.pathFrom(opts.input, { extname: e => '_converted' + e });
  const exists = await fs.exists(output);
  const probable = await isProbeable(output);
  if (exists) {
    if (opts.skip) return false;
    const answer = await select({
      message: [
        `Output exists: "${output}"`,
        !probable && `(unreadable)`
      ].filter(Boolean).join(' '),
      choices: {
        async overwrite() {
          // await fs.remove(output);
          await trash(output);
        },
        async cancel() {
          return false;
          throw new Error('User Cancelled');
        },
        async rename() {
          let i = 0;
          while (true) {
            i++;
            const newName = _.pathFrom(output, { extname: e => ` (${i})` + e });
            if (await fs.exists(newName)) continue;
            if (i > 100) throw new Error(`Couldn't find a new valid name`);
            output = newName;
            break;
          }
        },
      }
    });
    if (answer === false) return;
  }

  await fs.ensureDir(Path.dirname(output));
  if (!configuredOutput) {
    ffmpeg.output(output);
  }
  opts.output = output;
  return output;
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
  let probe
  try {
    probe = await ffprobe({ input: opts.output });
  } catch (error) {
    if (opts.halt === false) return { error };
    else throw error;
  }
  // probe.duration *= opts.speed || 1;
  const diff = {};
  diff.size = probe.size - opts.inputSize;
  diff.sizeString = _.diffString(probe.size, opts.inputSize);
  diff.duration = probe.duration - opts.inputDuration;
  diff.durationString = _.diffString(probe.duration, opts.inputDuration);
  diff.isSizeSignificant = diff.duration < .95 || 1.05 > diff.duration;
  diff.isDurationSignificant = diff.duration < .95 || 1.05 > diff.duration;

  function log({
    output = 'Output: ',
    size = 'Size: ',
    duration = 'Duration: ',
  } = {}, logger = console.log) {
    logger([
      `${output}"${opts.output}"`,
      diff.isSizeSignificant && `${size}${_.humanSize(probe.size)} (${diff.sizeString})`,
      diff.isDurationSignificant && `${duration}${_.humanDuration(probe.duration * 1000)} (${diff.durationString})`,
    ].filter(Boolean).join('\n'));
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
  }
}

function onProgress(opts) {
  const eta = _.eta();
  return (progress = {}) => {
    const pretty = {};
    const supposedOutputDuration = opts.inputDuration / (opts.speed || 1);
    if (progress.timemark) {
      const time = progress.timemark.split(':').reverse();
      let duration = 0;
      for (let i = 0; i < time.length; i++) {
        const element = time[i];
        duration += element * (60 ** i);
      }
      duration = _.minmax(duration);
      progress.duration = duration;
      progress.percentFull = duration / supposedOutputDuration;
      progress.percent = _.percent(progress.percentFull);
      pretty.percent = `${progress.percent}%`;
      pretty.timemark = progress.timemark;
    }
    if (progress.currentKbps) {
      progress.bitrate = _.toFixed(progress.currentKbps);
      pretty.bitrate = `Bitrate: ${progress.bitrate} kbps`;
    }
    if (progress.targetSize) {
      progress.size = parseInt(_.minmax(progress.targetSize) * 1024);
      pretty.size = `Size: ${_.humanSize(progress.size)}`;
    }
    if (progress.currentFps) {
      progress.fps = _.toFixed(_.minmax(progress.currentFps));
      pretty.fps = `FPS: ${progress.fps}`;
    }
    // string.push(`${progress.currentKbps} kbps`);
    if (progress.percentFull) {
      const ratio = progress.ratio = _.ratio(progress.percentFull / 100);
      Object.assign(progress, eta({ ratio }));
      pretty.elapsed = `Elapsed: ${_.humanDuration(progress.elapsed)}`;
      pretty.remaining = `ETA: ${_.humanDuration(progress.remaining)}`;
    }

    progress.pretty = pretty;
    progress.string = Object.values(pretty).join(' | ');

    if (opts.onProgress) {
      opts.onProgress(progress);
    } else if (!opts.silent) {
      _.stdoutLine(progress.string);
    }
  }
}

function findExponent(x) {
  /* from ffmpeg-speedup-video */
  for (let n = 1; n <= 10; n++) {
    const multiplier = Math.pow(10, (Math.log10(x) / n));
    if (0.5 <= multiplier && multiplier <= 2) {
      return { n, multiplier };
    }
  }
  throw new Error(`Could not find a multiple in the range 1-10`);
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
