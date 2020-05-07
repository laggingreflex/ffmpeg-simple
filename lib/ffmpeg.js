const Path = require('path');
const fs = require('fs-extra');
const Ffmpeg = require('fluent-ffmpeg');
const { confirm } = require('enquire-simple');
const ffprobe = require('./ffprobe');
const _ = require('./utils');

module.exports = ffmpeg;

/**
 * @param {Object} opts
 * @param {String} [opts.input] Input
 * @param {String} [opts.output] Output
 * @param {String} [opts.format] Format
 * @param {String} [opts.codec] Video Codec
 * @param {Array} [opts.inputOptions] Input Options
 * @param {Array} [opts.outputOptions] Output Options
 * @param {Boolean} [opts.log] Whether to log messages
 * @param {String} [opts.subtitles]
 * @param {('burn'|'stream')} [opts.subtitlesMode=burn]
 * @param {ffmpegCallback} [opts.ffmpeg] ffmpeg callback
 * @param {onProgressCallback} [opts.onProgress] onProgress callback
 */
async function ffmpeg(opts) {
  opts = initializeOpts(opts);

  /* Initialize ffmpeg */
  const ffmpeg = Ffmpeg({ logger: console.log, ...opts });

  if (opts.ffmpeg) {
    let ret = await opts.ffmpeg(ffmpeg, { input: opts.input });
    ret = ret || {};
  }

  await applyOptions(ffmpeg, opts);
  await ensureOutput(ffmpeg, opts);
  if (!await confirmOutput(ffmpeg, opts)) return;

  /* Attach loggers */
  // ffmpeg.on('start', console.log);
  ffmpeg.on('start', onStart(opts));
  ffmpeg.on('progress', onProgress(opts));

  /* Run */
  ffmpeg.run();

  /* Wait for end */
  const start = new Date;
  await Promise.race([
    new Promise(_ => ffmpeg.once('end', _)),
    new Promise((_, x) => ffmpeg.once('error', x)),
  ]);
  const processDuration = new Date - start;
  const processDurationString = _.durationString(processDuration / 1000);
  const { diff: outputDiff, ...outputProbe } = await probeOutput(opts);
  if (opts.log !== false) {
    outputProbe.log();
    console.log(`Done (in ${processDurationString})!`);
  }

  /* Return output */
  return { path: opts.output, ...outputProbe, diff: outputDiff, processDuration };
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
  if (opts.ss)
    ffmpeg.inputOptions('-ss', opts.ss);
  if (opts.filterComplex)
    filterComplex.push(..._.arrify(opts.filterComplex))
  // ffmpeg.outputOptions('-filter_complex', opts.filterComplex);
  if (opts.codec)
    ffmpeg.outputOptions('-c', opts.codec);
  if (opts.videoCodec)
    ffmpeg.videoCodec(opts.videoCodec);
  if (opts.crf)
    ffmpeg.outputOptions('-crf', opts.crf);
  if (opts.codecLevel)
    ffmpeg.outputOptions('-crf', opts.codecLevel);
  if (opts.audio === false)
    ffmpeg.outputOptions('-an');
  if (opts.rotate) {
    let angle = opts.rotate;
    if (Math.abs(angle) > Math.PI) {
      angle *= Math.PI / 180;
    }
    // ffmpeg.outputOptions('-vf', `rotate=${opts.rotate}`);
    // videoFilters.push(`rotate=${opts.rotate}`);
    filterComplex.push(`rotate=${angle}`);
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
    } else if (subtitlesMode === 'burn') {
      let subtitles = opts.subtitles;
      /* https://superuser.com/questions/1247197/ffmpeg-absolute-path-error */
      // subtitles = subtitles.replace(/([:\\])/g, '\\\\$1')
      subtitles = subtitles.replace(/\\/g, '/');
      subtitles = subtitles.replace(/:/g, '\\\\:');
      filterComplex.push(`subtitles=${subtitles}`);
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

  // ffmpeg.outputOptions('-max_muxing_queue_size 512');
}

async function ensureOutput(ffmpeg, opts) {
  let output = ffmpeg?._currentOutput?.target;
  if (!output) {
    output = opts.output || opts.input + '_converted.mp4';
    ffmpeg.output(output);
  }
  await fs.ensureDir(Path.dirname(output));
  return opts.output = output;
}

async function confirmOutput(ffmpeg, opts) {
  if (!await fs.exists(opts.output)) return true;
  const { diff: outputDiff, error, ...outputProbe } = await probeOutput({ ...opts, halt: false });
  if (error) {
    if (opts.silent) throw error;
    console.error(error);
    if (await confirm(`Remove unreadable output "${opts.output}"`)) {
      await fs.remove(opts.output);
      return true;
    } else {
      console.error(`Output exists but couldn't be read.`);
      return false;
    }
  }
  const diff = Math.abs((outputProbe.duration * (opts.speed || 1)) - opts.inputDuration) / 1000;
  const diffString = _.durationString(diff)
  const isDiffLowEnough = diff < (opts.outputDDOT || 5);
  // console.log({ outputDuration: outputProbe.duration, speed: opts.speed, inputDuration: opts.inputDuration, diff, isDiffLowEnough });
  if (!opts.silent) {
    outputProbe.log({ output: 'Output exists: ' });
    if (!isDiffLowEnough) {
      if (opts.speed) {
        console.log(`Duration difference (taking speed into account): ${diffString}`);
      } else {
        console.log(`Duration difference: ${diffString}`);
      }
    }
  }
  // if (!isDiffLowEnough) return true;
  if (opts.force) return true;
  if (opts.skip) return;
  if (opts.silent) return;
  return await confirm(`Overwrite "${opts.output}"`);
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

  function log({
    output = 'Output: ',
    size = 'Size: ',
    duration = 'Duration: ',
  } = {}, logger = console.log) {
    logger([
      `${output}"${opts.output}"`,
      `${size}${_.prettyBytes(probe.size)} (${diff.sizeString})`,
      `${duration}${_.durationString(probe.duration)} (${diff.durationString})`,
    ].join('\n'));
  }
  return { ...probe, diff, log };
}

function onStart(opts) {
  return (...args) => {
    if (opts.onStart) {
      opts.onStart(...args);
    } else if (opts.log !== false) {
      console.log(...args);
    }
  }
}

function onProgress(opts) {
  const eta = _.eta();
  return progress => {
    const string = [];
    // if (progress.percent) {
    //   progress.percent = Number(progress.percent);
    //   string.push(`${Math.floor(progress.percent)}%`);
    // }
    if (progress.timemark) {
      const time = progress.timemark.split(':').reverse();
      let duration = 0;
      for (let i = 0; i < time.length; i++) {
        const element = time[i];
        duration += element * (60 ** i);
      }
      progress.duration = duration;
      const inputDuration = opts.inputDuration / (opts.speed || 1);
      progress.percent = Math.floor((duration / inputDuration) * 100);
      string.push(`${progress.percent}%`);
      // string.push(`${_.durationString(progress.duration)}`);
      string.push(`${progress.timemark}`);
    }
    if (progress.currentKbps) {
      progress.currentKbps = parseInt(progress.currentKbps);
      string.push(`${progress.currentKbps} kbps`);
    }
    if (progress.currentFps) {
      progress.currentFps = Number(progress.currentFps);
      string.push(`FPS: ${progress.currentFps}`);
    }
    // string.push(`${progress.currentKbps} kbps`);
    if (progress.percent) {
      const ratio = progress.percent / 100;
      string.push(`ETA: ${eta({ratio})}`);
    }

    progress.string = string.join(' ');

    if (opts.onProgress) {
      opts.onProgress(progress);
    } else if (opts.log !== false) {
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
