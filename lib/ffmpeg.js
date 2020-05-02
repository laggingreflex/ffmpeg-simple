const Path = require('path');
const fs = require('fs-extra');
const Ffmpeg = require('fluent-ffmpeg');
const _ = require('./utils');

module.exports = ffmpeg;

/**
 * @param {object} opts
 * @param {string} [opts.input] Input file
 * @param {ffmpegCallback} [opts.ffmpeg] ffmpeg callback
 * @param {onProgressCallback} [opts.onProgress] onProgress callback
 */
async function ffmpeg(opts) {
  if (typeof opts === 'string') {
    opts = { input: opts };
  }
  if (typeof opts === 'function') {
    opts = { ffmpeg: opts };
  }
  if (!opts.ffmpeg) throw new Error('Need opts.ffmpeg callback');

  /* Initialize ffmpeg */
  const ffmpeg = Ffmpeg({ logger: console.log, ...opts });
  let ret = await opts.ffmpeg(ffmpeg, { input: opts.input });
  ret = ret || {};

  let output = ffmpeg?._currentOutput?.target;
  if (!output) {
    output = opts.input + '_compressed';
    ffmpeg.output(output);
  }

  await fs.ensureDir(Path.dirname(output));

  // let lastLog = ret.log || 'Running ffmpeg...';
  const errors = [];

  // ffmpeg.outputOptions('-crf 0');
  // ffmpeg.outputOptions('-preset ultrafast');

  ffmpeg.on('start', console.log);
  // console.log(lastLog);

  // ffmpeg.outputOptions('-max_muxing_queue_size 512');

  ffmpeg.run();

  // ffmpeg.on('progress', _ => console.debug(Object.entries(_).map(_ => _.join(': ')).join(', ')));
  ffmpeg.on('progress', progress => {
    const string = [];
    if (progress.percent) {
      progress.percent = Number(progress.percent);
      if (progress.percent < 10) {
        progress.percent = Number(progress.percent.toFixed(1));
        string.push(`${progress.percent.toFixed(1)}%`);
      } else {
        progress.percent = parseInt(progress.percent);
        string.push(`${progress.percent}%`);
      }
    }
    if (progress.timemark) {
      const time = progress.timemark.split(':').reverse();
      let duration = 0;
      for (let i = 0; i < time.length; i++) {
        const element = time[i];
        duration += element * (60 ** i);
      }
      progress.duration = duration;
      // string.push(`${_.durationString(progress.duration)}`);
      string.push(`${progress.timemark}`);
    }
    if (progress.currentKbps) {
      progress.currentKbps = parseInt(progress.currentKbps);
      string.push(`${progress.currentKbps} kbps`);
    }
    // if (progress.currentFps) {
    //   progress.currentFps = Number(progress.currentFps);
    //   str.push(`FPS: ${progress.currentFps}`);
    // }

    progress.string = string.join(' ');

    if (opts.onProgress) {
      opts.onProgress(progress);
    } else {
      _.stdoutLine(progress.string);
    }
  });

  /* Wait till ffmpeg ends (or errors) */
  try {
    await Promise.race([
      new Promise(_ => ffmpeg.once('end', _)),
      new Promise((_, x) => ffmpeg.once('error', x)),
    ]);
    // console.log(`Done! Output: "${output}"`);
    return { path: output, ...await getFileData(output) };
    return output;
  } catch (error) {
    errors.forEach(e => console.error(e))
    throw error;
  } finally {
    // clearInterval(logInterval);
  }

  function inputIndex(input) {
    return ffmpeg._inputs.findIndex(({ source }) => source === input)
  }

  function input(input) {
    ffmpeg.input(input);
    return inputIndex(input);
  }
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
