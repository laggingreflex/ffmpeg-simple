const { promisify } = require('util');
const Ffmpeg = require('fluent-ffmpeg');
const Ffprobe = promisify(Ffmpeg.ffprobe);
const _ = require('./utils');

module.exports = ffprobe;

/**
 * @param {Object} opts
 * @param {String} opts.input Input file
 * @param {Boolean} [opts.full]
 * @returns {Promise<metadata>}
 */
async function ffprobe(opts) {
  if (typeof opts === 'string') opts = { input: opts };

  const stats = await _.stat(opts.input);
  const probe = await Ffprobe(opts.input);
  // console.log(probe);
  const data = {};
  // return data;
  if (probe.format) {
    if (probe.format.tags) {
      data.title = probe.format.tags.title;
      data.artist = probe.format.tags.artist;
      data.date = probe.format.tags.date;
      data.comment = probe.format.tags.comment;
    }
    data.duration = probe.format.duration || 0;
    data.bitrate = Math.round(probe.format.bit_rate / 1000) || 0;
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
  data.createdAt = new Date(stats.ctime);
  // console.log({ video, audio, data });
  if (opts.full) data.full = probe;
  return data;
}

/**
 * @typedef {Object} metadata
 * @property {String} title
 * @property {String} artist
 * @property {String} date
 * @property {String} comment
 * @property {Number} duration
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
 * @property {Date} createdAt
 * @property {Object} [full]
 */
