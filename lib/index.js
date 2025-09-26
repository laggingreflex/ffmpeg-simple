console.debug = () => 1;

require('os').setPriority(0, 19);
const ffmpeg = require('./ffmpeg');
const ffprobe = require('./ffprobe');
const helpers = require('./helpers');
const utils = require('./utils');

module.exports = { ffmpeg, ffprobe, ...helpers, utils };
