require('os').setPriority(0, 19);
const ffmpeg = require('./ffmpeg');
const ffprobe = require('./ffprobe');
const helpers = require('./helpers');

module.exports = { ffmpeg, ffprobe, ...helpers };
