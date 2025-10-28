const { promisify } = require('util');
const Ffmpeg = require('fluent-ffmpeg');
const Ffprobe = promisify(Ffmpeg.ffprobe);
const Eloquent = require('eloquent-ffmpeg');

const _ = require('./utils');
const Error = _.Error;

const cache = {};

module.exports = ffprobe;

/**
 * @param {Object} opts
 * @param {String} opts.input Input file
 * @param {Boolean} [opts.full]
 * @returns {Promise<metadata>}
 */
async function ffprobe(opts = {}) {
  // console.log(`arguments:`, arguments);
  if (typeof opts === 'string') opts = { input: opts };
  let stats, probe;

  if (opts.input in cache) {
    if (opts.cache !== false) return cache[opts.input];
  }

  try {
    stats = await _.stat(opts.input);
  } catch (error) {
    if (opts.halt !== false) throw new Error(`Couldn't read input: ${opts.input}`, { error });
    else return;
  }
  try {
    probe = await Eloquent.probe(opts.input, {
      args: [
        ...(opts.extractKeyframes
          ? [
              '-show_frames',
              '-select_streams',
              'v',
              '-show_entries',
              'frame=key_frame,pkt_pts_time,pkt_pts,best_effort_timestamp_time',
            ]
          : []),
      ],
    });
    probe = probe.unwrap();
  } catch (error) {
    // console.log( {error});
    if (opts.halt !== false) throw new Error(`Couldn't read input: ${opts.input}`, { error });
    else return;
  }

  // console.log(probe);
  const data = { input: opts.input };
  // return data;
  if (probe.format) {
    if (probe.format.tags) {
      if (probe?.format?.tags?.title) data.title = probe.format.tags.title;
      if (probe?.format?.tags?.artist) data.artist = probe.format.tags.artist;
      if (probe?.format?.tags?.date) data.date = probe.format.tags.date;
      if (probe?.format?.tags?.comment) data.comment = probe.format.tags.comment;
    }
    data.duration = Number(probe.format.duration || 0);
    data.humanDuration = _.humanDuration(data.duration * 1000);
    data.bitrate = Math.round(Number(probe.format.bit_rate) / 1000) || 0;
  }
  let video;
  if (video = probe.streams.find(s => s.codec_type === 'video')) {
    // console.log({video});
    data.codec = video.codec_name;
    data.codecProfile = video.profile;
    data.codecLevel = video.level;
    data.width = video.width || 0;
    data.height = video.height || 0;
    data.aspectRatio = video.display_aspect_ratio;
    // data.framerate = eval( /* not a user input, so probably ok to eval */ video.r_frame_rate);
    const r_frame_rate = eval( /* not a user input, so probably ok to eval */ video.r_frame_rate) || 0;
    const avg_frame_rate = eval( /* not a user input, so probably ok to eval */ video.avg_frame_rate) || 0;
    data.framerate = Math.min(r_frame_rate, avg_frame_rate) || 0;
    // data.framerate = eval( /* not a user input, so probably ok to eval */ video.avg_frame_rate);
    data.videoDuration = video.duration;
  }
  let audio;
  if (audio = probe.streams.find(s => s.codec_type === 'audio')) {
    data.audioCodec = audio.codec_name;
    data.audioChannels = audio.channels || 0;
    data.audioSampleRate = audio.sample_rate || 0;
    data.audioBitrate = Math.round(audio.bit_rate / 1000) || 0;
    data.audioDuration = audio.duration;
  }
  data.size = stats.size;
  data.humanSize = _.humanSize(data.size);
  data.createdAt = new Date(stats.ctime);
  // console.log({ video, audio, data });
  if (opts.full) data.full = probe;
  if (opts.cache !== false) cache[opts.input] = data;
  Object.defineProperty(data, 'full', {
    enumerable: true,
    writable: true,
    configurable: true,
    value: probe,
  });
  return data;
}

/**
 * @typedef {Object} metadata
 * @property {String} title
 * @property {String} artist
 * @property {String} date
 * @property {String} comment
 * @property {Number} duration
 * @property {String} humanDuration
 * @property {Number} bitrate
 * @property {String} codec
 * @property {String} codecProfile
 * @property {Number} codecLevel
 * @property {Number} width
 * @property {Number} height
 * @property {String} aspectRatio
 * @property {Number} framerate
 * @property {Number} videoDuration
 * @property {String} audioCodec
 * @property {Number} audioChannels
 * @property {Number} audioSampleRate
 * @property {Number} audioBitrate
 * @property {Number} audioDuration
 * @property {Number} size
 * @property {String} humanSize
 * @property {Date} createdAt
 * @property {Object} [full]
 */
